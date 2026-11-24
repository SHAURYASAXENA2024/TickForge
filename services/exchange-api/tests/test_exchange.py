"""exchange-api tests, run against the fake engine in tests/fake_engine.py."""
import importlib.util
import random

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.symbols import ALL_SYMBOLS, START_PRICES
from app.traders import START_CASH, START_SHARES, Trader
from tests.conftest import TEST_SNAPSHOT, order, wait_for

TELEMETRY_KEYS = {
    "type", "uptime_s", "speed", "submitted", "processed", "queue_depth", "orders_per_sec", "trades_total",
    "trades_per_sec", "avg_latency_us", "p50_latency_us", "p99_latency_us", "cpu_pct", "rss_mb", "threads",
    "lat_hist", "producers", "book", "trades",
}


def trader(client, trader_id):
    return client.get(f"/traders/{trader_id}").json()


# ---- fills go to the real buyer and seller ------------------------------------------------------
def test_fill_moves_cash_and_shares_between_the_two_owners(client):
    assert order(client, 3, "SELL", 19000, 100).status_code == 200
    assert order(client, 7, "BUY", 19000, 100).status_code == 200
    wait_for(lambda: trader(client, 7)["trades"] == 1)

    buyer, seller = trader(client, 7), trader(client, 3)
    assert buyer["cash"] == START_CASH - 19000 * 100
    assert buyer["holdings"]["AAPL"] == START_SHARES + 100
    assert seller["cash"] == START_CASH + 19000 * 100
    assert seller["holdings"]["AAPL"] == START_SHARES - 100
    # trader 3 started with shares valued at the 18950 start price and sold at 19000
    assert seller["realized_pnl"] == (19000 - START_PRICES["AAPL"]) * 100
    assert buyer["realized_pnl"] == 0
    others = [trader(client, i) for i in (1, 2, 4)]
    assert all(t["cash"] == START_CASH and t["trades"] == 0 for t in others)


def test_cash_and_shares_are_conserved_over_many_random_trades(client):
    rng = random.Random(1)
    for _ in range(60):
        r = order(client, rng.randint(1, 24), rng.choice(["BUY", "SELL"]), rng.randint(18900, 19000),
                  rng.randint(1, 50), symbol=rng.choice(ALL_SYMBOLS[:3]))
        assert r.status_code == 200
    trades = wait_for(lambda: client.get("/trades?limit=500").json()["trades"])
    wait_for(lambda: sum(t["trades"] for t in client.get("/traders").json()["traders"]) == 2 * len(
        client.get("/trades?limit=500").json()["trades"]))
    assert len(trades) > 5, "the random orders should have produced some trades"

    everyone = client.get("/traders").json()["traders"]
    assert sum(t["cash"] for t in everyone) == 24 * START_CASH
    for symbol in ALL_SYMBOLS:
        assert sum(t["holdings"].get(symbol, 0) for t in everyone) == 24 * START_SHARES
    # so total value is conserved for any set of prices
    prices = {s: 12345 + i for i, s in enumerate(ALL_SYMBOLS)}
    value = sum(t["cash"] + sum(q * prices[s] for s, q in t["holdings"].items()) for t in everyone)
    assert value == 24 * START_CASH + 24 * START_SHARES * sum(prices.values())


def test_manual_orders_belong_to_kapinza_and_the_other_side_is_updated(client):
    order(client, 0, "SELL", 19000, 10)
    order(client, 5, "BUY", 19000, 10)
    wait_for(lambda: trader(client, 5)["trades"] == 1)
    assert trader(client, 5)["cash"] == START_CASH - 190000
    trade = client.get("/trades").json()["trades"][0]
    assert (trade["buyer_id"], trade["seller_id"]) == (5, 25)  # manual orders belong to Kapinza


def test_reject_and_bad_input(client):
    r = order(client, 1, "BUY", 19000, 10000)
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "insufficient_cash"
    assert order(client, 1, "HOLD", 19000, 1).status_code == 422
    assert order(client, 99, "BUY", 19000, 1).status_code == 422
    assert order(client, 26, "BUY", 19000, 1).status_code == 422
    assert order(client, 1, "BUY", 19000, 1, symbol="NOPE").status_code == 404
    assert client.get("/traders/99").status_code == 404


def test_cancel(client):
    order_id = order(client, 2, "BUY", 18000, 10).json()["order_id"]
    assert client.delete(f"/orders/{order_id}").status_code == 200
    assert client.delete(f"/orders/{order_id}").status_code == 409
    assert client.get("/orderbook?symbol=AAPL").json()["bids"] == []


# ---- orders and counterparties (P1) -------------------------------------------------------------
def orders_of(client, trader_id=25):
    return client.get(f"/orders?trader_id={trader_id}").json()["orders"]


def test_kapinza_orders_are_stored_with_status_and_filled_quantity(client):
    resting = order(client, 0, "BUY", 19000, 100).json()["order_id"]   # trader 0 = the order ticket
    row = wait_for(lambda: orders_of(client))[0]
    assert (row["order_id"], row["trader_id"], row["trader_name"]) == (resting, 25, "Kapinza")
    assert (row["side"], row["symbol"], row["quantity"], row["price_cents"]) == ("BUY", "AAPL", 100, 19000)
    assert (row["status"], row["filled"]) == ("open", 0)

    order(client, 4, "SELL", 19000, 30)
    wait_for(lambda: orders_of(client)[0]["status"] == "partially_filled")
    assert orders_of(client)[0]["filled"] == 30
    order(client, 4, "SELL", 19000, 70)
    wait_for(lambda: orders_of(client)[0]["status"] == "filled")
    assert orders_of(client)[0]["filled"] == 100
    # the sellers' orders were updated too
    assert [o["status"] for o in orders_of(client, 4)] == ["filled", "filled"]
    assert orders_of(client, 9) == []


def test_fills_name_the_counterparty_for_a_buy_and_for_a_sell(client):
    order(client, 3, "SELL", 19000, 10)                  # trader 3 is Rahul Verma
    buy_id = order(client, 0, "BUY", 19000, 10).json()["order_id"]
    wait_for(lambda: client.get("/traders/25/fills").json()["fills"])
    order(client, 6, "BUY", 19500, 5)                    # trader 6 buys, Kapinza sells to them
    sell_id = order(client, 0, "SELL", 19500, 5).json()["order_id"]
    fills = wait_for(lambda: len(client.get("/traders/25/fills").json()["fills"]) == 2 and
                     client.get("/traders/25/fills").json()["fills"])
    sold, bought = fills                                  # newest first
    assert (bought["side"], bought["counterparty_id"], bought["counterparty_name"]) == ("BUY", 3, "Rahul Verma")
    assert (bought["price_cents"], bought["quantity"], bought["order_id"]) == (19000, 10, buy_id)
    assert (sold["side"], sold["counterparty_id"], sold["counterparty_name"]) == ("SELL", 6, "Anil Kumar")
    assert (sold["price_cents"], sold["quantity"], sold["order_id"]) == (19500, 5, sell_id)
    # the names are stored on the fill itself, in the database
    saved = {t["trade_id"]: t for t in client.get("/trades/history").json()["trades"]}
    assert saved[bought["trade_id"]]["buyer_name"] == "Kapinza" and saved[bought["trade_id"]]["seller_name"] == "Rahul Verma"
    assert saved[sold["trade_id"]]["seller_name"] == "Kapinza"
    # and each fill is linked to both orders
    assert (bought["buy_order_id"], sold["sell_order_id"]) == (buy_id, sell_id)
    assert bought["sell_order_id"] != buy_id


def test_a_trader_never_trades_with_their_own_resting_order(client):
    own = order(client, 0, "SELL", 19000, 10).json()["order_id"]       # Kapinza, first in line
    other = order(client, 7, "SELL", 19000, 10).json()["order_id"]     # trader 7 behind it
    order(client, 0, "BUY", 19000, 10)
    fills = wait_for(lambda: client.get("/traders/25/fills").json()["fills"])
    assert len(fills) == 1 and fills[0]["counterparty_id"] == 7 and fills[0]["order_id"] != own
    assert fills[0]["sell_order_id"] == other
    assert [o["status"] for o in orders_of(client)][-1] == "open"      # Kapinza's own sell is still resting
    assert client.get("/orderbook?symbol=AAPL").json()["asks"] == [[19000, 10]]


def test_rejected_and_cancelled_orders_are_stored(client):
    assert order(client, 0, "BUY", 19000, 10000).status_code == 409    # insufficient_cash
    kept = order(client, 0, "BUY", 18000, 5).json()["order_id"]
    assert client.delete(f"/orders/{kept}").status_code == 200
    rows = wait_for(lambda: len(orders_of(client)) == 2 and
                    {r["status"] for r in orders_of(client)} == {"rejected", "cancelled"} and orders_of(client))
    rejected = next(r for r in rows if r["status"] == "rejected")
    assert rejected["reason"] == "insufficient_cash" and rejected["filled"] == 0 and rejected["quantity"] == 10000
    assert next(r for r in rows if r["order_id"] == kept)["status"] == "cancelled"
    assert client.get("/traders/99/fills").status_code == 404


# ---- cash and share reservation (P2) --------------------------------------------------------------
def reject_reason(response):
    assert response.status_code == 409
    return response.json()["detail"]["reason"]


def test_a_resting_buy_locks_cash_and_a_cancel_gives_it_back(client):
    oid = order(client, 3, "BUY", 19000, 100).json()["order_id"]
    t = trader(client, 3)
    assert (t["cash"], t["reserved_cash"], t["available_cash"]) == (START_CASH, 1_900_000, START_CASH - 1_900_000)
    assert client.delete(f"/orders/{oid}").status_code == 200
    t = trader(client, 3)
    assert (t["reserved_cash"], t["available_cash"]) == (0, START_CASH)


def test_a_resting_sell_locks_shares(client):
    oid = order(client, 4, "SELL", 19000, 120).json()["order_id"]
    t = trader(client, 4)
    assert t["reserved_shares"] == {"AAPL": 120} and t["holdings"]["AAPL"] == START_SHARES
    client.delete(f"/orders/{oid}")
    assert trader(client, 4)["reserved_shares"] == {}


def test_orders_without_funds_are_rejected_and_stored(client):
    # 10,000 shares at $190.00 is $1.9 million; the trader has $1 million
    assert reject_reason(order(client, 5, "BUY", 19000, 10_000)) == "insufficient_cash"
    # a trader holds 500 shares: selling 501 would be a short sale
    assert reject_reason(order(client, 5, "SELL", 19000, 501)) == "insufficient_shares"
    assert order(client, 5, "SELL", 19000, 500).status_code == 200
    assert reject_reason(order(client, 5, "SELL", 19000, 1)) == "insufficient_shares"  # all 500 are locked now
    reasons = sorted(o["reason"] for o in orders_of(client, 5) if o["status"] == "rejected")
    assert reasons == ["insufficient_cash", "insufficient_shares", "insufficient_shares"]
    assert client.get("/orderbook").json()["asks"] == [[19000, 500]]  # rejected orders never reached the book


def test_a_buyer_gets_the_price_improvement_back(client):
    order(client, 2, "SELL", 18900, 100)
    order(client, 6, "BUY", 19000, 100)  # limit $190.00, the trade prints at $189.00
    wait_for(lambda: trader(client, 6)["trades"] == 1)
    buyer, seller = trader(client, 6), trader(client, 2)
    assert (buyer["cash"], buyer["reserved_cash"]) == (START_CASH - 1_890_000, 0)
    assert buyer["holdings"]["AAPL"] == START_SHARES + 100
    assert (seller["cash"], seller["reserved_shares"]) == (START_CASH + 1_890_000, {})


def test_a_partial_fill_releases_only_the_filled_part(client):
    order(client, 7, "BUY", 19000, 100)
    order(client, 8, "SELL", 19000, 30)
    wait_for(lambda: trader(client, 7)["trades"] == 1)
    t = trader(client, 7)
    assert (t["cash"], t["reserved_cash"]) == (START_CASH - 570_000, 70 * 19000)


def test_reset_gives_every_virtual_trader_the_starting_balances_and_no_locks(client):
    order(client, 3, "BUY", 19000, 100)
    order(client, 4, "SELL", 18000, 10)
    order(client, 0, "BUY", 15000, 10)  # Kapinza keeps hers
    wait_for(lambda: trader(client, 3)["reserved_cash"] > 0)
    with client.websocket_connect("/ws/telemetry") as ws:
        ws.send_json({"cmd": "reset"})
        wait_for(lambda: trader(client, 3)["reserved_cash"] == 0 and trader(client, 4)["reserved_shares"] == {})
    assert trader(client, 3)["cash"] == START_CASH
    assert trader(client, 25)["reserved_cash"] == 150_000


# ---- order book ---------------------------------------------------------------------------------
def test_order_book_endpoint_and_websocket_show_resting_orders(client):
    order(client, 1, "BUY", 18900, 40)
    order(client, 2, "BUY", 18900, 10)
    order(client, 3, "SELL", 19100, 70)
    book = client.get("/orderbook?symbol=AAPL").json()
    assert book == {"symbol": "AAPL", "bids": [[18900, 50]], "asks": [[19100, 70]]}
    assert client.get("/orderbook?symbol=NVDA").json()["bids"] == []

    with client.websocket_connect("/ws/orderbook?symbol=AAPL") as ws:
        assert ws.receive_json()["bids"] == [[18900, 50]]
        order(client, 4, "BUY", 18800, 5)
        update = ws.receive_json()  # pushed when the book changes
        assert update["bids"] == [[18900, 50], [18800, 5]]


def test_traders_websocket_pushes_changes(client):
    with client.websocket_connect("/ws/traders") as ws:
        first = ws.receive_json()
        assert len(first["traders"]) == 24
        order(client, 3, "SELL", 19000, 5)
        order(client, 7, "BUY", 19000, 5)
        while True:  # skip updates that were sent before the fill was applied
            update = ws.receive_json()
            if update["traders"][6]["trades"] == 1 and update["traders"][6]["cash"] == START_CASH - 19000 * 5:
                break
        assert update["traders"][6]["cash"] == START_CASH - 19000 * 5


# ---- persistence --------------------------------------------------------------------------------
def test_every_trade_is_saved_once_with_the_real_trader_ids(client):
    for i in range(3):
        order(client, 10 + i, "SELL", 19000 + i, 10)
    order(client, 20, "BUY", 19010, 30)  # fills all three sells
    wait_for(lambda: client.get("/health").json()["trades"] == 3)

    saved = client.get("/trades/history").json()["trades"]
    assert len(saved) == 3
    assert {t["seller_id"] for t in saved} == {10, 11, 12}
    assert all(t["buyer_id"] == 20 and t["symbol"] == "AAPL" and t["quantity"] == 10 for t in saved)
    assert sorted(t["price_cents"] for t in saved) == [19000, 19001, 19002]
    assert client.get("/trades/history?symbol=TSLA").json()["trades"] == []
    assert client.get("/trades/history?start_ms=0&end_ms=1").json()["trades"] == []
    assert [t["trade_id"] for t in client.get("/trades").json()["trades"]] == [3, 2, 1]  # newest first


def test_trades_websocket_streams_new_trades(client):
    with client.websocket_connect("/ws/trades") as ws:
        assert ws.receive_json()["type"] == "history"
        order(client, 1, "SELL", 19000, 5)
        order(client, 2, "BUY", 19000, 5)
        trade = ws.receive_json()
        assert (trade["buyer_id"], trade["seller_id"], trade["price"], trade["qty"]) == (2, 1, 19000, 5)


def test_missing_database_module_is_a_startup_error(engine):
    if importlib.util.find_spec("tickforge_db"):
        pytest.skip("tickforge_db is installed")
    app = create_app(Settings(engine_port=engine.port, memory_db=False, reference_snapshot=TEST_SNAPSHOT))
    with pytest.raises(RuntimeError, match="tickforge_db"):
        with TestClient(app):
            pass


# ---- telemetry ----------------------------------------------------------------------------------
def next_of_type(ws, kind):
    for _ in range(50):
        msg = ws.receive_json()
        if msg["type"] == kind:
            return msg
    pytest.fail(f"no {kind} message")


def test_telemetry_has_exactly_the_fields_the_frontend_parses(client):
    order(client, 1, "BUY", 18900, 40)
    order(client, 3, "SELL", 19000, 5)
    order(client, 7, "BUY", 19000, 5)
    with client.websocket_connect("/ws/telemetry") as ws:
        assert ws.receive_json() == {"type": "status", "state": "stopped", "error": ""}
        stats = next_of_type(ws, "stats")
        assert set(stats) == TELEMETRY_KEYS
        assert stats["speed"] == 1 and stats["book"]["bids"] == [[18900, 40]]
        assert len(stats["lat_hist"]) == 16 and stats["producers"] == [3]
        assert all(isinstance(stats[k], (int, float)) for k in TELEMETRY_KEYS - {"type", "lat_hist", "producers", "book", "trades"})


def test_telemetry_trades_batch_uses_trader_ids(client):
    with client.websocket_connect("/ws/telemetry") as ws:
        order(client, 3, "SELL", 19000, 5)
        order(client, 7, "BUY", 19000, 5)
        seen = []
        while not seen:
            seen = next_of_type(ws, "stats")["trades"]
        assert seen == [{"id": 1, "price": 19000, "qty": 5, "buy": 7, "sell": 3}]


def test_telemetry_commands(client):
    with client.websocket_connect("/ws/telemetry") as ws:
        ws.receive_json()
        ws.send_json({"cmd": "start"})
        assert next_of_type(ws, "status")["state"] == "running"
        ws.send_json({"cmd": "pause"})
        assert next_of_type(ws, "status")["state"] == "paused"
        ws.send_json({"cmd": "stop"})
        assert next_of_type(ws, "status")["state"] == "stopped"
        ws.send_json({"cmd": "speed", "value": 10})
        wait_for(lambda: client.app.state.exchange.speed == 10)
        assert next_of_type(ws, "stats")["speed"] == 10
        ws.send_json({"cmd": "speed", "value": 7})  # not one of 1, 10, 100: ignored
        ws.send_json({"cmd": "order", "side": "SELL", "qty": 25, "price": 19500})
        wait_for(lambda: client.get("/orderbook").json()["asks"] == [[19500, 25]])
        ws.send_json({"cmd": "order", "side": "BUY", "qty": 99999, "price": 19500})
        assert "max_qty" in next_of_type(ws, "status")["error"]
        assert client.app.state.exchange.speed == 10


def test_telemetry_reset_restores_traders_and_cancels_their_orders(client):
    order(client, 3, "SELL", 19000, 5)
    order(client, 7, "BUY", 19000, 5)
    order(client, 8, "BUY", 16000, 5)  # stays on the book
    wait_for(lambda: trader(client, 7)["trades"] == 1)
    with client.websocket_connect("/ws/telemetry") as ws:
        ws.send_json({"cmd": "reset"})
        wait_for(lambda: trader(client, 7)["trades"] == 0)
    assert trader(client, 7)["cash"] == START_CASH
    wait_for(lambda: client.get("/orderbook").json()["bids"] == [])


def test_virtual_traders_trade_by_themselves_when_running(engine):
    settings = Settings(engine_port=engine.port, memory_db=True, traders_start_running=True,
                        orders_per_second=200, tick_seconds=0.1, reconnect_seconds=0.1,
                        reference_snapshot=TEST_SNAPSHOT)
    with TestClient(create_app(settings)) as c:
        wait_for(lambda: c.get("/health").json()["trades"] >= 3, timeout=15)
        everyone = c.get("/traders").json()["traders"]
        assert sum(t["cash"] for t in everyone) == 24 * START_CASH


# ---- reconnect ----------------------------------------------------------------------------------
def test_client_reconnects_when_the_engine_comes_back(client, engine):
    with client.websocket_connect("/ws/telemetry") as ws:
        assert ws.receive_json()["state"] == "stopped"
        engine.stop()
        wait_for(lambda: client.get("/health").json()["engine"] == "disconnected")
        assert order(client, 1, "BUY", 19000, 1).status_code == 503
        status = next_of_type(ws, "status")
        assert status["state"] == "closed" and "not reachable" in status["error"]

        engine.start()
        wait_for(lambda: client.get("/health").json()["engine"] == "connected")
        assert order(client, 1, "BUY", 19000, 1).status_code == 200
        assert next_of_type(ws, "status")["state"] == "stopped"


# ---- trader accounts (no engine needed) -----------------------------------------------------------
def test_trader_average_cost_pnl_and_short_cover():
    t = Trader(1, "x", "random", cash=0)
    t.apply_fill("AAPL", "BUY", 100, 10)
    t.apply_fill("AAPL", "BUY", 200, 10)           # 20 shares, cost 3000, average 150
    t.apply_fill("AAPL", "SELL", 180, 10)          # sells half: +30 per share
    assert (t.holdings["AAPL"], t.cost["AAPL"], t.realized_pnl, t.cash) == (10, 1500, 300, -3000 + 1800)
    t.apply_fill("AAPL", "SELL", 180, 15)          # 10 held + 5 short; only the 10 held count for P&L
    assert (t.holdings["AAPL"], t.realized_pnl) == (-5, 600)
    t.apply_fill("AAPL", "BUY", 170, 5)            # buying the short back adds no cost basis
    assert (t.holdings["AAPL"], t.cost["AAPL"]) == (0, 0)


def test_activity_empty_then_filled_for_kapinza(client):
    empty = client.get("/traders/25/activity?symbol=AAPL").json()
    assert empty["fills"] == 0 and empty["net_position"] == 0 and empty["simulated"] is True
    order(client, 3, "SELL", 19000, 10)
    order(client, 0, "BUY", 19000, 10)
    wait_for(lambda: client.get("/traders/25/activity?symbol=AAPL").json()["fills"] == 1)
    order(client, 6, "BUY", 19500, 4)
    order(client, 0, "SELL", 19500, 4)
    a = wait_for(lambda: (x := client.get("/traders/25/activity?symbol=AAPL").json())["fills"] == 2 and x)
    assert (a["bought"], a["sold"], a["net_position"]) == (10, 4, 6)
    assert a["realized_pnl_cents"] == (19500 - 19000) * 4
    assert client.get("/traders/25/activity?symbol=TSLA").json()["fills"] == 0  # per symbol
    assert client.get("/traders/99/activity?symbol=AAPL").status_code == 404
    assert client.get("/traders/25/activity?symbol=NOPE").status_code == 404
