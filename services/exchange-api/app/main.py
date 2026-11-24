"""exchange-api (port 8001): the glue between the browser, the matching engine and the database.

Run:  uvicorn app.main:app --port 8001      (from services/exchange-api/)
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from app import recovery, routes
from app.alerts import AlertBook
from app.scheduling import RoundRobin, StopBook
from app.config import Settings
from app.db import open_db
from app.engine_client import EngineClient, EngineDown, Rejected
from app import reference as reference_feed
from app.symbols import ALL_SYMBOLS, DEFAULT_SYMBOL, SYMBOL_BY_ID, SYMBOL_IDS
from app.traders import MANUAL_ID, make_manual_trader, make_order, make_traders, trader_name

log = logging.getLogger("exchange-api")

SPEEDS = (1, 10, 100)
# Orders the engine refused have no engine id. They get ids from this range so that they can
# still be stored (status "rejected") without ever clashing with a real order id.
REJECTED_ID_BASE = 1 << 62
STATS_NUMBERS = ["uptime_s", "submitted", "processed", "queue_depth", "orders_per_sec", "trades_total",
                 "trades_per_sec", "avg_latency_us", "p50_latency_us", "p99_latency_us", "cpu_pct",
                 "rss_mb", "threads"]
STATS_LISTS = ["lat_hist", "producers"]


class Exchange:
    """All live state of the API: traders, recent trades, order books and WebSocket clients."""

    def __init__(self, settings: Settings, reference_fetch=None) -> None:
        self.settings = settings
        # The real price level of each symbol: the engine's band and the traders' quotes are built
        # around it. It starts from the saved snapshot and is refreshed live (see app/reference.py).
        self.reference, self._reference_fetch = reference_feed.new_reference(settings, reference_fetch)
        self._seeded: dict[str, int] = {}  # what the engine was last told, per symbol
        self._seeded_connection = 0
        self.prices: dict[str, int] = dict(self.reference.prices)  # last trade price per symbol, cents
        self.traders = make_traders(self.prices)
        self.round_robin = RoundRobin(self.traders)
        self.stops = StopBook()
        self.alerts = AlertBook(None if settings.memory_db else settings.data_dir, set(ALL_SYMBOLS))
        # Control of single traders and symbols: "running", "paused" (no new orders, resting orders stay)
        # or "stopped" (no new orders, resting orders cancelled). The global state above still applies to all.
        self.trader_state: dict[int, str] = {}
        self.symbol_state: dict[str, str] = {}
        self._manual_in_flight = 0
        self.demo = recovery.Demo()  # the crash recovery demo: while active, nothing may write to the engine
        self.manual = make_manual_trader(self.prices)  # Kapinza: the order ticket's account
        self._reject_seq = REJECTED_ID_BASE
        self.engine = EngineClient(settings.engine_host, settings.engine_port, settings.reconnect_seconds)
        self.engine.on_trade = self._on_trade
        self.engine.on_order = self._on_order_accepted
        self.engine.on_reject = self._on_order_rejected
        self.store = None
        self.engine_accounts: dict[int, dict] = {}  # trader id -> account as the engine reports it
        self.recent_trades: deque[dict] = deque(maxlen=500)  # newest first
        self.books: dict[str, dict] = {s: {"symbol": s, "bids": [], "asks": []} for s in ALL_SYMBOLS}
        self.state = "running" if settings.traders_start_running else "stopped"
        self.speed = 1
        self.rng = random.Random()
        self.notice = ""  # one-off message shown in the next telemetry status

        self._persist_queue: asyncio.Queue  # created in start(), inside the running event loop
        self._db_pool = ThreadPoolExecutor(max_workers=1)  # the database is used from one thread only
        self._tasks: list[asyncio.Task] = []
        self._telemetry_trades: deque[dict] = deque(maxlen=50)
        self._last_status = ""
        self._last_sent: dict = {}
        self.trade_clients: set[WebSocket] = set()
        self.trader_clients: set[WebSocket] = set()
        self.telemetry_clients: set[WebSocket] = set()
        self.book_clients: dict[WebSocket, str] = {}  # websocket -> symbol it watches

    # ---- start / stop -------------------------------------------------------------------------
    async def start(self) -> None:
        self.store = open_db(self.settings)  # raises if tickforge_db is missing
        newest = self.store.list_orders(None, 1)  # rejected ids are the highest, so the newest is the max
        if newest and newest[0]["order_id"] >= REJECTED_ID_BASE:
            self._reject_seq = newest[0]["order_id"]
        self._persist_queue = asyncio.Queue()
        self.engine.start()
        self._tasks = [asyncio.create_task(self._persist_loop()),
                       asyncio.create_task(self._order_loop()),
                       asyncio.create_task(self._tick_loop()),
                       asyncio.create_task(self._reference_loop())]

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.engine.stop()
        self._db_pool.shutdown(wait=True)

    async def db(self, fn, *args):
        """Run a database call on the single database thread."""
        return await asyncio.get_running_loop().run_in_executor(self._db_pool, fn, *args)

    # ---- trades -------------------------------------------------------------------------------
    def _on_trade(self, msg: dict) -> None:
        """Called by the engine client for every trade. Moves cash and shares between the real traders."""
        symbol = SYMBOL_BY_ID.get(msg["symbol_id"])
        if symbol is None:
            log.warning("trade for unknown symbol_id %s", msg["symbol_id"])
            return
        price, qty = msg["price"], msg["qty"]
        self.prices[symbol] = price
        self._fire_stops(symbol, price)
        self.alerts.check(symbol, price)
        for trader_id, side in ((msg["buyer_id"], "BUY"), (msg["seller_id"], "SELL")):
            account = self.account(trader_id)
            if account is not None:  # id 0 = an order whose owner is unknown
                account.apply_fill(symbol, side, price, qty)
        trade = {
            "trade_id": msg["trade_id"], "symbol": symbol, "price": price, "qty": qty,
            "buy_order_id": msg["buy_order_id"], "sell_order_id": msg["sell_order_id"],
            "buyer_id": msg["buyer_id"], "seller_id": msg["seller_id"],
            "taker_side": msg.get("taker_side", ""), "ts_ms": msg.get("ts_ms") or int(time.time() * 1000),
        }
        self.recent_trades.appendleft(trade)
        self._telemetry_trades.append(
            {"id": trade["trade_id"], "price": price, "qty": qty, "buy": trade["buyer_id"], "sell": trade["seller_id"]})
        self._persist_queue.put_nowait(("trade", trade))

    def _fire_stops(self, symbol: str, price: int) -> None:
        """Send the orders of the stops that this last price fires. Called from the trade callback."""
        if not self.stops.orders:
            return
        for stop in self.stops.triggered(symbol, price):
            asyncio.get_running_loop().create_task(self._release_stop(stop))

    async def _release_stop(self, stop) -> None:
        try:
            await self.place_order(stop.trader_id, stop.symbol, stop.side, StopBook.release_price(stop), stop.qty)
        except (EngineDown, Rejected, asyncio.TimeoutError) as exc:
            log.info("stop %s fired but the order was not placed: %r", stop.stop_id, exc)

    def account(self, trader_id: int):
        """The Trader object for an id: 1..24 are virtual traders, 25 is Kapinza, 0 has none."""
        if 1 <= trader_id <= len(self.traders):
            return self.traders[trader_id - 1]
        return self.manual if trader_id == MANUAL_ID else None

    # ---- orders: everything the database keeps about them ---------------------------------------
    def _order_row(self, order_id: int, trader_id: int, symbol_id: int, side: str, price: int, qty: int,
                   status: str = "open", filled: int = 0, reason: str = "") -> dict:
        now = int(time.time() * 1000)
        return {"order_id": order_id, "trader_id": trader_id, "trader_name": trader_name(trader_id),
                "side": side, "symbol": SYMBOL_BY_ID[symbol_id], "quantity": qty, "price_cents": price,
                "status": status, "filled": filled, "created_ms": now, "updated_ms": now, "reason": reason}

    def _on_order_accepted(self, order_id: int, trader_id: int, symbol_id: int, side: str, price: int, qty: int) -> None:
        self._persist_queue.put_nowait(("order", self._order_row(order_id, trader_id, symbol_id, side, price, qty)))

    def _on_order_rejected(self, trader_id: int, symbol_id: int, side: str, price: int, qty: int, reason: str) -> None:
        self._reject_seq += 1
        row = self._order_row(self._reject_seq, trader_id, symbol_id, side, price, qty, "rejected", 0, reason)
        self._persist_queue.put_nowait(("order", row))

    def _insert_trade(self, trade: dict) -> None:
        self.store.insert_trade(
            trade_id=trade["trade_id"], symbol=trade["symbol"], price_cents=trade["price"],
            quantity=trade["qty"], buy_order_id=trade["buy_order_id"], sell_order_id=trade["sell_order_id"],
            buyer_id=trade["buyer_id"], seller_id=trade["seller_id"], timestamp_ms=trade["ts_ms"],
            buyer_name=trader_name(trade["buyer_id"]), seller_name=trader_name(trade["seller_id"]))
        for order_id in (trade["buy_order_id"], trade["sell_order_id"]):  # both orders get the fill
            self._add_fill_to_order(order_id, trade["qty"])

    def _add_fill_to_order(self, order_id: int, qty: int) -> None:
        row = self.store.get_order(order_id)
        if row is None:
            return  # an order placed before orders were stored
        row["filled"] = min(row["quantity"], row["filled"] + qty)
        row["status"] = "filled" if row["filled"] >= row["quantity"] else "partially_filled"
        row["updated_ms"] = int(time.time() * 1000)
        self.store.upsert_order(**row)

    def _mark_cancelled(self, order_id: int) -> None:
        row = self.store.get_order(order_id)
        if row is None or row["status"] in ("filled", "cancelled", "rejected"):
            return
        row["status"] = "cancelled"
        row["updated_ms"] = int(time.time() * 1000)
        self.store.upsert_order(**row)

    def _mark_amended(self, order_id: int, new_remaining: int) -> None:
        row = self.store.get_order(order_id)
        if row is None or row["status"] not in ("open", "partially_filled"):
            return
        row["quantity"] = row["filled"] + new_remaining  # the order is now this big in total
        row["updated_ms"] = int(time.time() * 1000)
        self.store.upsert_order(**row)

    async def amend_order(self, order_id: int, price: int | None, qty: int | None) -> dict:
        """Change a resting order. A lower quantity at the same price is done in the engine and keeps the
        order's place in the queue. A new price or a bigger quantity is a cancel plus a new order (a new
        order id, at the back of the queue). `qty` is the new remaining quantity. Raises EngineDown or Rejected."""
        recovery.guard_orders(self)
        row = await self.db(self.store.get_order, order_id)
        if row is None:
            raise Rejected("unknown_order")
        if row["status"] not in ("open", "partially_filled"):
            raise Rejected("not_open")
        remaining = row["quantity"] - row["filled"]
        new_price = row["price_cents"] if price is None else price
        new_qty = remaining if qty is None else qty
        if new_price == row["price_cents"] and new_qty == remaining:
            raise Rejected("nothing_to_change")
        if new_price == row["price_cents"] and new_qty < remaining:
            await self.engine.amend(order_id, new_qty)
            self._persist_queue.put_nowait(("amend", (order_id, new_qty)))
            return {"order_id": order_id, "kind": "reduced", "keeps_priority": True, "remaining": new_qty}
        # Replace: check what the engine would check first, so a refused replacement never costs the old order.
        symbol = row["symbol"]
        ref = self.reference.prices.get(symbol)
        if ref and abs(new_price - ref) * 100 > ref * 20:
            raise Rejected("price_band")
        await self.refresh_accounts()
        acct = self.engine_accounts.get(row["trader_id"])
        if acct is not None:
            if row["side"] == "BUY":
                free = acct["cash"] - acct["reserved_cash"] + row["price_cents"] * remaining
                if free < new_price * new_qty:
                    raise Rejected("insufficient_cash")
            else:
                held = acct["shares"].get(symbol, 0) - acct["reserved_shares"].get(symbol, 0) + remaining
                if held < new_qty:
                    raise Rejected("insufficient_shares")
        await self.cancel_order(order_id)
        try:
            new_id = await self.place_order(row["trader_id"], symbol, row["side"], new_price, new_qty)
        except Rejected:
            # something only the engine knows (such as its maximum order size): put the old order back,
            # at the back of the queue, rather than leave the trader with nothing
            try:
                await self.place_order(row["trader_id"], symbol, row["side"], row["price_cents"], remaining)
            except (EngineDown, Rejected, asyncio.TimeoutError):
                log.exception("order %s was cancelled by an amend and could not be put back", order_id)
            raise
        return {"order_id": new_id, "replaced": order_id, "kind": "replaced", "keeps_priority": False, "remaining": new_qty}

    async def cancel_order(self, order_id: int) -> int:
        """Cancel one order in the engine and record it. Raises EngineDown or Rejected."""
        recovery.guard_orders(self)
        result = await self.engine.cancel(order_id)
        self._persist_queue.put_nowait(("cancel", order_id))
        return result

    async def _persist_loop(self) -> None:
        """Save orders, fills and cancels to the database in the order they happened, then push
        each trade to /ws/trades clients."""
        while True:
            kind, item = await self._persist_queue.get()
            if kind == "barrier":  # everything queued before this marker is saved
                await self.db(lambda: None)
                if not item.done():
                    item.set_result(True)
                continue
            try:
                if kind == "trade":
                    await self.db(self._insert_trade, item)
                elif kind == "order":
                    await self.db(lambda row=item: self.store.upsert_order(**row))
                elif kind == "cancel":
                    await self.db(self._mark_cancelled, item)
                elif kind == "amend":
                    await self.db(self._mark_amended, *item)
            except Exception:
                log.exception("could not save %s %s", kind, item)
            if kind == "trade":
                await self._send(self.trade_clients, json.dumps(item))

    # ---- orders -------------------------------------------------------------------------------
    async def place_order(self, trader_id: int, symbol: str, side: str, price: int, qty: int) -> int:
        """Send one order to the engine. Trader id 0 means a manual order: it belongs to Kapinza.
        Raises EngineDown or Rejected."""
        recovery.guard_orders(self)
        if self.symbol_state.get(symbol, "running") != "running":
            raise Rejected("symbol paused")
        manual = (trader_id or MANUAL_ID) == MANUAL_ID
        self._manual_in_flight += manual
        try:
            return await self.engine.new_order(trader_id or MANUAL_ID, SYMBOL_IDS[symbol], side, price, qty)
        finally:
            self._manual_in_flight -= manual

    # ---- control of one trader or one symbol ----------------------------------------------------
    async def control(self, kind: str, key, action: str) -> str:
        """pause, resume or stop one trader (kind "trader") or one symbol (kind "symbol"). Everything else
        keeps running. Returns the new state. A stop also cancels the resting orders it covers."""
        state = {"pause": "paused", "resume": "running", "stop": "stopped"}[action]
        (self.trader_state if kind == "trader" else self.symbol_state)[key] = state
        if state == "stopped":
            rows = await self.db(self.store.list_orders, key if kind == "trader" else None, 1000)
            for row in rows:
                if row["status"] in ("open", "partially_filled") and (kind == "trader" or row["symbol"] == key):
                    try:
                        await self.cancel_order(row["order_id"])
                    except (EngineDown, Rejected, asyncio.TimeoutError):
                        pass
        await self._send_status()
        return state

    def runnable_traders(self) -> list:
        return [t for t in self.traders if self.trader_state.get(t.trader_id, "running") == "running"]

    def runnable_symbols(self) -> list[str]:
        return [s for s in ALL_SYMBOLS if self.symbol_state.get(s, "running") == "running"]

    async def _order_loop(self) -> None:
        """The virtual traders: one random trader sends one order each round."""
        while True:
            rate = self.settings.orders_per_second * self.speed
            await asyncio.sleep(1 / rate if rate > 0 else 1)
            if self.state != "running" or not self.engine.connected:
                continue
            if self._manual_in_flight:
                continue  # Kapinza's orders go first: virtual traders wait until they are in the engine
            symbols = self.runnable_symbols()
            trader = self._next_trader()
            if trader is None or not symbols:
                continue
            order = make_order(trader, self.reference.prices, self.rng, symbols)
            if order is None:
                continue
            symbol, side, price, qty = order
            try:
                await self.place_order(trader.trader_id, symbol, side, price, qty)
            except (EngineDown, Rejected, asyncio.TimeoutError) as exc:
                log.debug("order by trader %s not placed: %r", trader.trader_id, exc)

    def _next_trader(self):
        """The next virtual trader that is not paused or stopped (round robin, or random)."""
        if self.settings.dispatch != "roundrobin":
            pool = self.runnable_traders()
            return self.rng.choice(pool) if pool else None
        for _ in range(len(self.traders)):
            trader = self.round_robin.take()
            if self.trader_state.get(trader.trader_id, "running") == "running":
                return trader
        return None

    def next_up(self):
        """The virtual trader _next_trader would pick next in round robin, without advancing. None in random mode."""
        if self.settings.dispatch != "roundrobin":
            return None
        for i in range(len(self.traders)):
            trader = self.traders[(self.round_robin._next + i) % len(self.traders)]
            if self.trader_state.get(trader.trader_id, "running") == "running":
                return trader
        return None

    # ---- reference prices -----------------------------------------------------------------------
    async def _reference_loop(self) -> None:
        """Read live prices every `reference_refresh_seconds`, and make sure the engine has them."""
        due = 0.0
        while True:
            try:
                if time.monotonic() >= due:
                    await reference_feed.refresh(self.reference, self._reference_fetch, self.settings.data_dir)
                    due = time.monotonic() + self.settings.reference_refresh_seconds
                await self.seed_engine()
            except Exception:
                log.exception("reference prices failed")
            await asyncio.sleep(0.5)

    async def seed_engine(self) -> None:
        """Tell the engine each symbol's reference price when it differs from what it has. The engine
        then measures its price band from it and clears resting orders far from it."""
        if not self.engine.connected or self.demo.active:
            return  # (the demo needs the engine's log to stand still)
        try:
            if self._seeded_connection != self.engine.connections:
                reply = await self.engine.command("reference")  # a restarted engine replays its own
                self._seeded = {SYMBOL_BY_ID[int(s)]: p for s, p in reply.get("prices", {}).items() if int(s) in SYMBOL_BY_ID}
                self._seeded_connection = self.engine.connections
            for symbol, price in self.reference.prices.items():
                if self._seeded.get(symbol) == price:
                    continue
                await self.engine.set_reference(SYMBOL_IDS[symbol], price, self.settings.reference_clear_pct)
                old = self._seeded.get(symbol)
                self._seeded[symbol] = price
                last = self.prices.get(symbol, price)
                if old is None or abs(last - price) * 100 > price * self.settings.reference_clear_pct:
                    self.prices[symbol] = price  # the old level is gone from the book, so is its last price
        except (EngineDown, Rejected, asyncio.TimeoutError):
            self._seeded_connection = 0  # try again from the engine's own list

    def reference_snapshot(self) -> dict:
        ref = self.reference
        return {"prices": dict(ref.prices), "source": ref.source, "as_of": ref.as_of, "updated_ms": ref.updated_ms,
                "live": sorted(ref.live), "seeded": dict(self._seeded)}

    async def reset_traders(self) -> None:
        """Cancel the virtual traders' open orders, then give each of them the starting cash and
        shares, in the engine (which owns the balances) and here."""
        recovery.guard_orders(self)
        for order_id, (owner, _) in list(self.engine.owners.items()):
            if owner > len(self.traders):
                continue  # Kapinza's orders are not touched by a reset
            try:
                await self.cancel_order(order_id)
            except (EngineDown, Rejected, asyncio.TimeoutError):
                self.engine.owners.pop(order_id, None)
        try:
            await self.engine.reset_accounts(1, len(self.traders))
        except (EngineDown, Rejected, asyncio.TimeoutError):
            log.warning("could not reset the accounts in the engine")
        for trader in self.traders:
            trader.reset(self.reference.prices)
        await self.refresh_accounts()

    async def refresh_accounts(self) -> None:
        """Read every account from the engine (it owns cash, shares and reservations)."""
        if not self.engine.connected:
            return
        try:
            reply = await self.engine.command("accounts")
        except (EngineDown, asyncio.TimeoutError):
            return
        if not reply.get("enabled"):
            self.engine_accounts = {}
            return
        self.engine_accounts = {
            a["trader_id"]: {
                "cash": a["cash"], "reserved_cash": a["reserved_cash"],
                "shares": {SYMBOL_BY_ID[int(s)]: q for s, q in a["shares"].items() if int(s) in SYMBOL_BY_ID},
                "reserved_shares": {SYMBOL_BY_ID[int(s)]: q for s, q in a["reserved_shares"].items() if int(s) in SYMBOL_BY_ID},
            }
            for a in reply["accounts"]
        }

    # ---- order books --------------------------------------------------------------------------
    async def get_book(self, symbol: str) -> dict:
        """Live book from the engine; the last known book if the engine is unreachable."""
        if self.engine.connected:
            try:
                reply = await self.engine.command("book", symbol_id=SYMBOL_IDS[symbol], depth=10)
                self.books[symbol] = {"symbol": symbol, "bids": reply.get("bids", []), "asks": reply.get("asks", [])}
            except (EngineDown, asyncio.TimeoutError):
                pass
        return self.books[symbol]

    def traders_snapshot(self) -> dict:
        view = lambda t: t.to_dict(self.prices, self.engine_accounts.get(t.trader_id))  # noqa: E731
        def with_state(t):
            return {**view(t), "state": self.trader_state.get(t.trader_id, "running")}
        return {"traders": [with_state(t) for t in self.traders], "manual": view(self.manual),
                "symbols": dict(self.symbol_state),
                "dispatch": {"mode": self.settings.dispatch,
                             "next_trader_id": (nxt.trader_id if (nxt := self.next_up()) else None),
                             "turns": self.round_robin.turns}}

    # ---- telemetry ----------------------------------------------------------------------------
    def status_message(self) -> dict:
        if not self.engine.connected:
            error = f"engine not reachable at {self.settings.engine_host}:{self.settings.engine_port}"
            return {"type": "status", "state": "closed", "error": error}
        return {"type": "status", "state": self.state, "error": self.notice}

    async def stats_message(self) -> dict:
        stats = await self.engine.command("stats")
        book = self.books[DEFAULT_SYMBOL]
        msg = {"type": "stats", "speed": self.speed}
        msg.update({k: stats.get(k, 0) for k in STATS_NUMBERS})
        msg.update({k: stats.get(k, []) for k in STATS_LISTS})
        msg["book"] = {"bids": book["bids"], "asks": book["asks"]}
        msg["trades"] = list(self._telemetry_trades)
        self._telemetry_trades.clear()
        return msg

    async def handle_command(self, cmd: dict) -> None:
        """A command from the browser (see docs/CONTRACTS.md section 5)."""
        name = cmd.get("cmd")
        if name in ("start", "pause", "stop"):
            self.state = {"start": "running", "pause": "paused", "stop": "stopped"}[name]
        elif name == "reset":
            try:
                await self.reset_traders()
            except Rejected as exc:
                self.notice = f"reset not done: {exc.reason}"
        elif name == "speed":
            if cmd.get("value") in SPEEDS:
                self.speed = cmd["value"]
        elif name == "order":
            await self._manual_order(cmd)
        else:
            return
        await self._send_status()

    async def _manual_order(self, cmd: dict) -> None:
        side, qty, price = cmd.get("side"), cmd.get("qty"), cmd.get("price")
        ok = side in ("BUY", "SELL") and all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in (qty, price))
        if not ok:
            self.notice = "order not sent: side, qty and price (in cents) are required"
            return
        try:
            await self.place_order(MANUAL_ID, DEFAULT_SYMBOL, side, price, qty)
        except Rejected as exc:
            self.notice = f"order rejected: {exc.reason}"
        except (EngineDown, asyncio.TimeoutError):
            self.notice = "order not sent: engine not reachable"

    async def _send_status(self) -> None:
        text = json.dumps(self.status_message())
        self.notice = ""
        if text != self._last_status:
            self._last_status = text
            await self._send(self.telemetry_clients, text)

    # ---- pushing to WebSocket clients ---------------------------------------------------------
    async def _send_one(self, ws: WebSocket, text: str) -> None:
        try:
            await ws.send_text(text)
        except Exception:
            self.forget(ws)  # the browser went away

    async def _send(self, clients: set, text: str) -> None:
        for ws in list(clients):
            await self._send_one(ws, text)

    def forget(self, ws: WebSocket) -> None:
        """Remove a WebSocket client from every list."""
        self.trade_clients.discard(ws)
        self.trader_clients.discard(ws)
        self.telemetry_clients.discard(ws)
        self.book_clients.pop(ws, None)
        for key in [k for k in self._last_sent if k[0] is ws]:
            del self._last_sent[key]

    async def push_changed(self, ws: WebSocket, key: str, payload: dict) -> None:
        """Send `payload` to one client unless it already has exactly this."""
        text = json.dumps(payload)
        if self._last_sent.get((ws, key)) != text:
            self._last_sent[(ws, key)] = text
            await self._send_one(ws, text)

    async def _tick_loop(self) -> None:
        """Every tick: refresh books, then push whatever changed."""
        while True:
            await asyncio.sleep(self.settings.tick_seconds)
            try:
                await self.tick()
            except Exception:
                log.exception("tick failed")

    async def tick(self) -> None:
        for symbol, price in list(self.prices.items()):  # the last price, or the reference price when nothing has traded
            self.alerts.check(symbol, price)
        await self._send_status()
        await self.refresh_accounts()
        if self.engine.connected:
            try:
                for symbol in ALL_SYMBOLS:
                    await self.get_book(symbol)
                if self.telemetry_clients:
                    await self._send(self.telemetry_clients, json.dumps(await self.stats_message()))
            except (EngineDown, asyncio.TimeoutError):
                pass
        if not self.telemetry_clients:
            self._telemetry_trades.clear()
        for ws, symbol in list(self.book_clients.items()):
            await self.push_changed(ws, "book", self.books[symbol])
        snapshot = self.traders_snapshot()
        for ws in list(self.trader_clients):
            await self.push_changed(ws, "traders", snapshot)


def create_app(settings: Settings | None = None, reference_fetch=None) -> FastAPI:
    settings = settings or Settings.from_env()
    exchange = Exchange(settings, reference_fetch)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await exchange.start()
        yield
        await exchange.stop()

    app = FastAPI(title="TickForge exchange-api", lifespan=lifespan)
    app.state.exchange = exchange
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:8443", "http://127.0.0.1:8443"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(routes.router)
    app.include_router(recovery.router)
    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
app = create_app()
