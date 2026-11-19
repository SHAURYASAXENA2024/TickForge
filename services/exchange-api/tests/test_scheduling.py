"""FIFO (engine book), round robin dispatch and stop orders."""
import asyncio

from app.config import Settings
from app.main import Exchange
from app.scheduling import RoundRobin, StopBook
from tests.conftest import TEST_SNAPSHOT, order, wait_for


def test_round_robin_gives_every_trader_a_turn_before_a_second():
    rr = RoundRobin(list(range(1, 25)))
    first = [rr.take() for _ in range(24)]
    assert sorted(first) == list(range(1, 25))          # nobody starves, nobody twice
    assert [rr.take() for _ in range(3)] == [1, 2, 3]   # then it starts over, in the same order


def test_dispatch_default_is_round_robin_and_random_is_still_selectable():
    assert Settings().dispatch == "roundrobin"
    ex = Exchange(Settings(memory_db=True, reference_snapshot=TEST_SNAPSHOT, dispatch="roundrobin"))
    assert [ex.round_robin.take().trader_id for _ in range(30)] == [*range(1, 25), *range(1, 7)]


def test_stop_triggers_by_side():
    book = StopBook()
    buy = book.add(1, "AAPL", "BUY", 10_500, None, 10)     # buy stop: fires at or above 105.00
    sell = book.add(2, "AAPL", "SELL", 9_500, 9_400, 10)   # sell stop-limit: fires at or below 95.00
    other = book.add(3, "TSLA", "BUY", 100, None, 1)
    assert book.triggered("AAPL", 10_000) == []
    assert book.triggered("AAPL", 10_500) == [buy]
    assert book.triggered("AAPL", 10_600) == []            # a fired stop is gone
    assert book.triggered("AAPL", 9_400) == [sell]
    assert book.triggered("AAPL", 1) == [] and other.stop_id in book.orders   # other symbols are untouched
    assert StopBook.release_price(sell) == 9_400            # stop-limit uses its limit
    assert StopBook.release_price(other) == 105             # a plain stop crosses by 5 percent


def test_stop_order_fires_into_the_engine_when_the_last_price_reaches_it(client):
    placed = client.post("/stops", json={"trader_id": 0, "symbol": "AAPL", "side": "BUY", "stop_price": 19100,
                                         "limit_price": 19200, "qty": 5})
    assert placed.status_code == 200 and placed.json()["kind"] == "stop_limit"
    assert len(client.get("/stops").json()["stops"]) == 1
    order(client, 3, "SELL", 19200, 5)                    # resting ask that the fired stop can hit
    order(client, 4, "SELL", 19100, 1)
    order(client, 5, "BUY", 19100, 1)                     # a trade at 191.00 reaches the stop
    wait_for(lambda: client.get("/stops").json()["stops"] == [])
    fills = wait_for(lambda: client.get("/traders/25/fills").json()["fills"])
    assert fills[0]["side"] == "BUY" and fills[0]["quantity"] == 5 and fills[0]["price_cents"] <= 19200


def test_stop_validation_and_cancel(client):
    bad = {"trader_id": 0, "symbol": "AAPL", "side": "BUY", "stop_price": 0, "qty": 1}
    assert client.post("/stops", json=bad).status_code == 422
    assert client.post("/stops", json={**bad, "stop_price": 5, "symbol": "NOPE"}).status_code == 404
    sid = client.post("/stops", json={**bad, "stop_price": 5}).json()["stop_id"]
    assert client.delete(f"/stops/{sid}").status_code == 200
    assert client.delete(f"/stops/{sid}").status_code == 404
