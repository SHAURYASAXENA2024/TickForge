"""HTTP and WebSocket routes (see docs/CONTRACTS.md section 5)."""
from __future__ import annotations

import asyncio
import json
import time
from collections import deque

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.ledger import compute_activity
from app.report import WINDOWS_MS, build_report
from app.engine_client import EngineDown, Rejected
from app.symbols import ALL_SYMBOLS, DEFAULT_SYMBOL, SYMBOL_IDS
from app.traders import MANUAL_ID, trader_name

router = APIRouter()


class OrderIn(BaseModel):
    trader_id: int = 0  # 0 = a manual order (Kapinza); 1..24 are the virtual traders, 25 is Kapinza
    symbol: str
    side: str
    price: int  # cents
    qty: int


class StopIn(BaseModel):
    trader_id: int = 0
    symbol: str
    side: str
    stop_price: int  # cents: the trigger, compared with the last trade price
    limit_price: int | None = None  # cents: set for a stop-limit order, left out for a plain stop
    qty: int


def _exchange(request: Request):
    return request.app.state.exchange


def _check_symbol(symbol: str) -> str:
    if symbol not in SYMBOL_IDS:
        raise HTTPException(status_code=404, detail=f"unknown symbol {symbol}")
    return symbol


# ---- REST -----------------------------------------------------------------------------------------
@router.get("/health")
async def health(request: Request):
    ex = _exchange(request)
    return {
        "status": "ok",
        "engine": "connected" if ex.engine.connected else "disconnected",
        "trades": await ex.db(ex.store.count),
    }


MAX_ORDER_QTY = 10_000
ORDERS_PER_SECOND = 10
_order_times: dict[str, deque] = {}


def _rate_limit(client: str) -> None:
    """At most ORDERS_PER_SECOND manual orders per second per client; the error says when to retry."""
    now = time.monotonic()
    times = _order_times.setdefault(client, deque())
    while times and now - times[0] >= 1.0:
        times.popleft()
    if len(times) >= ORDERS_PER_SECOND:
        raise HTTPException(status_code=429, detail="too many orders: at most 10 per second", headers={"Retry-After": "1"})
    times.append(now)


@router.post("/orders")
async def post_order(order: OrderIn, request: Request):
    ex = _exchange(request)
    if order.trader_id in (0, MANUAL_ID):  # the form sends as Kapinza; virtual traders do not use this endpoint
        _rate_limit(request.client.host if request.client else "unknown")
    _check_symbol(order.symbol)
    if order.side not in ("BUY", "SELL") or order.price <= 0 or order.qty <= 0:
        raise HTTPException(status_code=422, detail="side must be BUY or SELL; price and qty must be positive")
    if order.qty > MAX_ORDER_QTY:
        raise HTTPException(status_code=422, detail=f"shares must be a whole number from 1 to {MAX_ORDER_QTY}")
    if not 0 <= order.trader_id <= MANUAL_ID:
        raise HTTPException(status_code=422, detail=f"trader_id must be 0 to {MANUAL_ID}")
    try:
        order_id = await ex.place_order(order.trader_id, order.symbol, order.side, order.price, order.qty)
    except Rejected as exc:
        raise HTTPException(status_code=409, detail={"reason": exc.reason})
    except (EngineDown, asyncio.TimeoutError):
        raise HTTPException(status_code=503, detail="engine not reachable")
    return {"order_id": order_id}


@router.delete("/orders/{order_id}")
async def delete_order(order_id: int, request: Request):
    ex = _exchange(request)
    try:
        await ex.cancel_order(order_id)
    except Rejected as exc:
        raise HTTPException(status_code=409, detail={"reason": exc.reason})
    except (EngineDown, asyncio.TimeoutError):
        raise HTTPException(status_code=503, detail="engine not reachable")
    return {"order_id": order_id}


def _stop_view(stop) -> dict:
    return {"stop_id": stop.stop_id, "trader_id": stop.trader_id, "symbol": stop.symbol, "side": stop.side,
            "stop_price": stop.stop_price, "limit_price": stop.limit_price, "qty": stop.qty,
            "kind": "stop_limit" if stop.limit_price is not None else "stop"}


@router.post("/stops")
async def post_stop(stop: StopIn, request: Request):
    """Hold a stop or stop-limit order until the last trade price reaches `stop_price`, then send it
    to the engine. Held in memory only (lost if exchange-api restarts); funds are reserved when it fires."""
    ex = _exchange(request)
    if not ex.settings.stop_orders:
        raise HTTPException(status_code=404, detail="stop orders are switched off")
    _check_symbol(stop.symbol)
    if stop.side not in ("BUY", "SELL") or stop.stop_price <= 0 or stop.qty <= 0 or (stop.limit_price is not None and stop.limit_price <= 0):
        raise HTTPException(status_code=422, detail="side must be BUY or SELL; prices and qty must be positive")
    if not 0 <= stop.trader_id <= MANUAL_ID:
        raise HTTPException(status_code=422, detail=f"trader_id must be 0 to {MANUAL_ID}")
    held = ex.stops.add(stop.trader_id or MANUAL_ID, stop.symbol, stop.side, stop.stop_price, stop.limit_price, stop.qty)
    return _stop_view(held)


@router.get("/stops")
async def list_stops(request: Request):
    return {"stops": [_stop_view(s) for s in _exchange(request).stops.orders.values()]}


@router.delete("/stops/{stop_id}")
async def delete_stop(stop_id: int, request: Request):
    if not _exchange(request).stops.cancel(stop_id):
        raise HTTPException(status_code=404, detail="no such stop")
    return {"stop_id": stop_id}


class AmendIn(BaseModel):
    price: int | None = None  # cents: a new price loses the order's place in the queue
    qty: int | None = None  # the new remaining quantity: lower keeps the place, higher loses it


@router.patch("/orders/{order_id}")
async def patch_order(order_id: int, body: AmendIn, request: Request):
    """Amend a resting order. Same price and a lower quantity: the order keeps its priority. Any other
    change is a cancel plus a new order with a new id (priority lost)."""
    ex = _exchange(request)
    if body.price is None and body.qty is None:
        raise HTTPException(status_code=422, detail="give a price or a qty")
    if (body.price is not None and body.price <= 0) or (body.qty is not None and body.qty <= 0):
        raise HTTPException(status_code=422, detail="price and qty must be positive")
    try:
        return await ex.amend_order(order_id, body.price, body.qty)
    except Rejected as exc:
        raise HTTPException(status_code=409, detail={"reason": exc.reason})
    except (EngineDown, asyncio.TimeoutError):
        raise HTTPException(status_code=503, detail="engine not reachable")


@router.get("/orderbook")
async def get_orderbook(request: Request, symbol: str = DEFAULT_SYMBOL):
    return await _exchange(request).get_book(_check_symbol(symbol))


@router.get("/trades")
async def get_trades(request: Request, limit: int = 100):
    return {"trades": list(_exchange(request).recent_trades)[: max(0, limit)]}


@router.get("/trades/history")
async def get_history(request: Request, start_ms: int = 0, end_ms: int | None = None, symbol: str | None = None):
    ex = _exchange(request)
    if symbol is not None:
        _check_symbol(symbol)
    end = end_ms if end_ms is not None else int(time.time() * 1000) + 1
    return {"trades": await ex.db(ex.store.range, start_ms, end, symbol)}


@router.get("/traders")
async def get_traders(request: Request):
    ex = _exchange(request)
    await ex.refresh_accounts()  # balances and locks live in the engine
    return ex.traders_snapshot()


@router.get("/traders/{trader_id}")
async def get_trader(trader_id: int, request: Request):
    ex = _exchange(request)
    account = ex.account(trader_id)
    if account is None:
        raise HTTPException(status_code=404, detail="no such trader")
    await ex.refresh_accounts()
    return account.to_dict(ex.prices, ex.engine_accounts.get(trader_id))


@router.get("/orders")
async def list_orders(request: Request, trader_id: int | None = None, limit: int = 100):
    """Orders from the database, newest first, with their status and filled quantity."""
    ex = _exchange(request)
    if trader_id == 0:
        trader_id = MANUAL_ID
    return {"orders": await ex.db(ex.store.list_orders, trader_id, max(0, min(limit, 1000)))}


@router.get("/traders/{trader_id}/fills")
async def trader_fills(trader_id: int, request: Request, limit: int = 100):
    """One trader's fills from the database, newest first. Each one says which of this
    trader's orders was filled and who was on the other side."""
    ex = _exchange(request)
    if ex.account(trader_id) is None:
        raise HTTPException(status_code=404, detail="no such trader")
    trades = await ex.db(ex.store.trades_by_trader, trader_id, max(0, min(limit, 1000)))
    fills = []
    for t in trades:
        bought = t["buyer_id"] == trader_id
        other_id = t["seller_id"] if bought else t["buyer_id"]
        name = t.get("seller_name" if bought else "buyer_name") or trader_name(other_id)
        fills.append({
            "trade_id": t["trade_id"], "symbol": t["symbol"], "side": "BUY" if bought else "SELL",
            "price_cents": t["price_cents"], "quantity": t["quantity"], "timestamp_ms": t["timestamp_ms"],
            "order_id": t["buy_order_id"] if bought else t["sell_order_id"],
            "counterparty_id": other_id, "counterparty_name": name or "unknown",
            "buy_order_id": t["buy_order_id"], "sell_order_id": t["sell_order_id"],
            "buyer_name": t.get("buyer_name", ""), "seller_name": t.get("seller_name", ""),
        })
    return {"trader_id": trader_id, "fills": fills}


@router.get("/traders/{trader_id}/activity")
async def trader_activity(trader_id: int, request: Request, symbol: str = DEFAULT_SYMBOL):
    """Trading activity for one trader and one symbol, computed from the fills in the database
    (FIFO lots). Values are simulated: the trades are paper trades."""
    ex = _exchange(request)
    if ex.account(trader_id) is None:
        raise HTTPException(status_code=404, detail="no such trader")
    _check_symbol(symbol)
    trades = await ex.db(ex.store.trades_by_trader, trader_id, 1_000_000)
    fills = [{**t, "side": "BUY" if t["buyer_id"] == trader_id else "SELL"} for t in trades if t["symbol"] == symbol]
    return {"trader_id": trader_id, "symbol": symbol, **compute_activity(fills, ex.prices.get(symbol))}


@router.get("/report/summary")
async def report_summary(request: Request, trader: str = "all", window: str = "session"):
    """Statistics for the Report tab, computed from the orders table and the trades in the database.
    trader: all, kapinza or a trader id (1 to 25). window: session, 5m or 1m. All values are simulated."""
    ex = _exchange(request)
    if window != "session" and window not in WINDOWS_MS:
        raise HTTPException(status_code=422, detail="window must be session, 5m or 1m")
    if trader not in ("all", "kapinza"):
        if not trader.isdigit() or ex.account(int(trader)) is None:
            raise HTTPException(status_code=404, detail="no such trader")
    now_ms = int(time.time() * 1000)
    orders = await ex.db(ex.store.list_orders, None, 1_000_000)
    trades = await ex.db(ex.store.range, 0, now_ms + 1, None)
    return build_report(orders, trades, {t.trader_id: t.strategy for t in ex.traders}, trader, window, now_ms)


@router.get("/reference")
async def get_reference(request: Request):
    """The reference price of every symbol (cents) and where it came from: "yahoo" (read live from
    market-data), "mixed", "snapshot" (saved prices, e.g. when offline) or "sample". Yahoo is
    delayed by up to 15 minutes, and trades are simulated."""
    return _exchange(request).reference_snapshot()


class ControlIn(BaseModel):
    action: str  # pause, resume or stop


def _action(body: ControlIn) -> str:
    if body.action not in ("pause", "resume", "stop"):
        raise HTTPException(status_code=422, detail="action must be pause, resume or stop")
    return body.action


@router.post("/traders/{trader_id}/control")
async def control_trader(trader_id: int, body: ControlIn, request: Request):
    """Pause, resume or stop one virtual trader. The others keep trading."""
    ex = _exchange(request)
    if not 1 <= trader_id < MANUAL_ID:
        raise HTTPException(status_code=404, detail="no such virtual trader")
    return {"trader_id": trader_id, "state": await ex.control("trader", trader_id, _action(body))}


@router.post("/symbols/{symbol}/control")
async def control_symbol(symbol: str, body: ControlIn, request: Request):
    """Pause, resume or stop one symbol: no new orders for it from anyone until resumed."""
    ex = _exchange(request)
    _check_symbol(symbol)
    return {"symbol": symbol, "state": await ex.control("symbol", symbol, _action(body))}


@router.get("/symbols")
async def get_symbols(request: Request):
    states = _exchange(request).symbol_state
    return {"symbols": [{"symbol": s, "id": SYMBOL_IDS[s], "state": states.get(s, "running")} for s in ALL_SYMBOLS]}


# ---- WebSockets -----------------------------------------------------------------------------------
async def _wait_until_closed(ws: WebSocket, ex) -> None:
    """Keep the socket open and ignore what the client sends, until it disconnects."""
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ex.forget(ws)


@router.websocket("/ws/trades")
async def ws_trades(ws: WebSocket):
    ex = ws.app.state.exchange
    await ws.accept()
    await ws.send_text(json.dumps({"type": "history", "trades": list(ex.recent_trades)[:50]}))
    ex.trade_clients.add(ws)
    await _wait_until_closed(ws, ex)


@router.websocket("/ws/orderbook")
async def ws_orderbook(ws: WebSocket, symbol: str = DEFAULT_SYMBOL):
    ex = ws.app.state.exchange
    await ws.accept()
    if symbol not in SYMBOL_IDS:
        await ws.close(code=1008)
        return
    ex.book_clients[ws] = symbol
    await ex.push_changed(ws, "book", await ex.get_book(symbol))
    await _wait_until_closed(ws, ex)


@router.websocket("/ws/traders")
async def ws_traders(ws: WebSocket):
    ex = ws.app.state.exchange
    await ws.accept()
    ex.trader_clients.add(ws)
    await ex.push_changed(ws, "traders", ex.traders_snapshot())
    await _wait_until_closed(ws, ex)


@router.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    ex = ws.app.state.exchange
    await ws.accept()
    ex.telemetry_clients.add(ws)
    await ws.send_text(json.dumps(ex.status_message()))
    try:
        while True:
            try:
                cmd = json.loads(await ws.receive_text())
            except json.JSONDecodeError:
                continue
            if isinstance(cmd, dict):
                await ex.handle_command(cmd)
    except WebSocketDisconnect:
        pass
    finally:
        ex.forget(ws)
