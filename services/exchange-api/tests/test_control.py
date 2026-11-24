"""Pausing, resuming and stopping one trader or one symbol, and manual-order priority."""
import asyncio

from app.config import Settings
from app.main import Exchange
from tests.conftest import TEST_SNAPSHOT, order, wait_for


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_paused_trader_is_skipped_and_the_rest_keep_going():
    ex = Exchange(Settings(memory_db=True, reference_snapshot=TEST_SNAPSHOT))
    ex.trader_state[3] = "paused"
    picked = [ex._next_trader().trader_id for _ in range(48)]
    assert 3 not in picked and set(picked) == set(range(1, 25)) - {3}
    ex.trader_state[3] = "running"
    assert 3 in [ex._next_trader().trader_id for _ in range(24)]


def test_everyone_paused_gives_no_trader():
    ex = Exchange(Settings(memory_db=True, reference_snapshot=TEST_SNAPSHOT))
    for t in ex.traders:
        ex.trader_state[t.trader_id] = "stopped"
    assert ex._next_trader() is None and ex.runnable_traders() == []


def test_trader_control_endpoint_and_state_in_snapshot(client):
    assert client.post("/traders/4/control", json={"action": "pause"}).json() == {"trader_id": 4, "state": "paused"}
    rows = {t["trader_id"]: t["state"] for t in client.get("/traders").json()["traders"]}
    assert rows[4] == "paused" and rows[5] == "running"
    assert client.post("/traders/4/control", json={"action": "resume"}).json()["state"] == "running"
    assert client.post("/traders/4/control", json={"action": "dance"}).status_code == 422
    assert client.post("/traders/25/control", json={"action": "pause"}).status_code == 404


def test_stopping_a_trader_cancels_only_that_traders_resting_orders(client):
    order(client, 4, "SELL", 19500, 10)
    order(client, 5, "SELL", 19600, 10)
    wait_for(lambda: len(client.get("/orders?trader_id=4").json()["orders"]) == 1 and client.get("/orders?trader_id=5").json()["orders"])
    client.post("/traders/4/control", json={"action": "stop"})
    wait_for(lambda: client.get("/orders?trader_id=4").json()["orders"][0]["status"] == "cancelled")
    assert client.get("/orders?trader_id=5").json()["orders"][0]["status"] == "open"


def test_symbol_pause_blocks_new_orders_for_that_symbol_only(client):
    client.post("/symbols/AAPL/control", json={"action": "pause"})
    r = order(client, 0, "BUY", 19000, 1)
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "symbol paused"
    assert order(client, 0, "BUY", 100, 1, symbol="TSLA").status_code in (200, 409)
    assert order(client, 0, "BUY", 100, 1, symbol="TSLA").json().get("detail", {}).get("reason") != "symbol paused"
    states = {s["symbol"]: s["state"] for s in client.get("/symbols").json()["symbols"]}
    assert states["AAPL"] == "paused" and states["TSLA"] == "running"
    client.post("/symbols/AAPL/control", json={"action": "resume"})
    assert order(client, 0, "BUY", 19000, 1).status_code == 200


def test_symbol_stop_cancels_its_resting_orders(client):
    order(client, 3, "SELL", 19500, 5)
    order(client, 3, "SELL", 600000, 5, symbol="TSLA")
    wait_for(lambda: len(client.get("/orders?trader_id=3").json()["orders"]) == 2)
    client.post("/symbols/AAPL/control", json={"action": "stop"})
    rows = lambda: {o["symbol"]: o["status"] for o in client.get("/orders?trader_id=3").json()["orders"]}  # noqa: E731
    wait_for(lambda: rows().get("AAPL") == "cancelled")
    assert rows()["TSLA"] != "cancelled"


def test_virtual_traders_wait_while_a_manual_order_is_in_flight():
    async def scenario():
        ex = Exchange(Settings(memory_db=True, reference_snapshot=TEST_SNAPSHOT, orders_per_second=500))
        ex.state = "running"
        ex.engine.connected = True
        sent = []

        async def fake_place(trader_id, symbol, side, price, qty):
            sent.append(trader_id)
            return 1

        ex.place_order = fake_place
        ex._manual_in_flight = 1
        task = asyncio.create_task(ex._order_loop())
        await asyncio.sleep(0.2)
        held = len(sent)
        ex._manual_in_flight = 0
        await asyncio.sleep(0.2)
        task.cancel()
        return held, len(sent)

    held, after = run(scenario())
    assert held == 0 and after > 0


# ---- cancel and amend ---------------------------------------------------------------------------
def book_ids(client):
    return client.get("/orders?trader_id=3").json()["orders"]


def test_amend_down_keeps_priority_and_reduces_the_lock(client):
    first = order(client, 3, "BUY", 19000, 100).json()["order_id"]
    second = order(client, 4, "BUY", 19000, 100).json()["order_id"]
    wait_for(lambda: client.get("/traders/3").json()["reserved_cash"] == 19000 * 100)
    r = client.patch(f"/orders/{first}", json={"qty": 40})
    assert r.status_code == 200 and r.json()["keeps_priority"] is True and r.json()["order_id"] == first
    wait_for(lambda: client.get("/traders/3").json()["reserved_cash"] == 19000 * 40)
    wait_for(lambda: client.get(f"/orders?trader_id=3").json()["orders"][0]["quantity"] == 40)
    order(client, 5, "SELL", 19000, 60)
    wait_for(lambda: client.get("/traders/3").json()["trades"] == 1)
    assert client.get("/traders/3").json()["holdings"]["AAPL"] == 540      # 40 shares filled the first order first
    assert client.get("/traders/4").json()["trades"] == 1                  # the second only got the other 20
    assert first != second


def test_amend_price_or_up_replaces_the_order_and_loses_priority(client):
    first = order(client, 3, "BUY", 19000, 10).json()["order_id"]
    order(client, 4, "BUY", 19000, 10)
    wait_for(lambda: client.get(f"/orders?trader_id=3").json()["orders"])
    r = client.patch(f"/orders/{first}", json={"qty": 20}).json()
    assert r["kind"] == "replaced" and r["keeps_priority"] is False and r["replaced"] == first and r["order_id"] != first
    rows = {o["order_id"]: o for o in wait_for(lambda: len(client.get("/orders?trader_id=3").json()["orders"]) == 2 and
                                                  client.get("/orders?trader_id=3").json()["orders"])}
    assert rows[first]["status"] == "cancelled" and rows[r["order_id"]]["quantity"] == 20
    order(client, 5, "SELL", 19000, 10)
    wait_for(lambda: client.get("/traders/4").json()["trades"] == 1)   # the older order of trader 4 was first now
    assert client.get("/traders/3").json()["trades"] == 0


def test_amend_refusals_change_nothing(client):
    oid = order(client, 3, "BUY", 19000, 10).json()["order_id"]
    wait_for(lambda: client.get("/orders?trader_id=3").json()["orders"])
    assert client.patch(f"/orders/{oid}", json={}).status_code == 422
    assert client.patch(f"/orders/{oid}", json={"qty": 10}).json()["detail"]["reason"] == "nothing_to_change"
    assert client.patch(f"/orders/{oid}", json={"price": 99999999}).json()["detail"]["reason"] == "price_band"
    assert client.patch(f"/orders/{oid}", json={"qty": 9000}).json()["detail"]["reason"] == "insufficient_cash"
    assert client.patch("/orders/999999", json={"qty": 1}).json()["detail"]["reason"] == "unknown_order"
    assert client.get("/orders?trader_id=3").json()["orders"][0]["status"] == "open"   # still there, untouched
    assert client.delete(f"/orders/{oid}").status_code == 200
    assert client.patch(f"/orders/{oid}", json={"qty": 1}).json()["detail"]["reason"] == "not_open"


def test_cancel_releases_the_reservation(client):
    oid = order(client, 3, "BUY", 19000, 10).json()["order_id"]
    wait_for(lambda: client.get("/traders/3").json()["reserved_cash"] == 190000)
    client.delete(f"/orders/{oid}")
    wait_for(lambda: client.get("/traders/3").json()["reserved_cash"] == 0)


def test_a_refused_replacement_puts_the_old_order_back(client):
    from app.engine_client import Rejected

    ex = client.app.state.exchange
    oid = order(client, 3, "BUY", 19000, 10).json()["order_id"]
    wait_for(lambda: client.get("/orders?trader_id=3").json()["orders"])
    real, calls = ex.place_order, []

    async def refuse_the_first(*args):
        calls.append(args)
        if len(calls) == 1:
            raise Rejected("max_qty")  # something only the engine knows
        return await real(*args)

    ex.place_order = refuse_the_first
    r = client.patch(f"/orders/{oid}", json={"qty": 20})
    ex.place_order = real
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "max_qty"
    rows = wait_for(lambda: len(client.get("/orders?trader_id=3").json()["orders"]) == 2 and client.get("/orders?trader_id=3").json()["orders"])
    open_rows = [o for o in rows if o["status"] == "open"]
    assert len(open_rows) == 1 and open_rows[0]["quantity"] == 10 and open_rows[0]["order_id"] != oid
