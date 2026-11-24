"""Reference prices: seeding the engine, refreshing, the band, the offline fallback. No network:
the live read is a function the test supplies, and the snapshot is a file in this folder."""
import asyncio
import json
import random
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app import reference
from app.config import Settings
from app.main import create_app
from app.symbols import ALL_SYMBOLS, START_PRICES, SYMBOL_IDS
from app.traders import make_order, make_traders
from tests.conftest import TEST_SNAPSHOT, order, wait_for


def settings_for(engine, **extra):
    base = dict(engine_port=engine.port, memory_db=True, traders_start_running=False, tick_seconds=0.1,
                reconnect_seconds=0.1, reference_snapshot=TEST_SNAPSHOT, reference_refresh_seconds=0.2)
    base.update(extra)
    return Settings(**base)


def test_the_engine_is_seeded_from_the_snapshot_when_offline(engine):
    with TestClient(create_app(settings_for(engine))) as client:
        wait_for(lambda: len(engine.reference) == len(ALL_SYMBOLS))
        assert engine.reference == {SYMBOL_IDS[s]: p for s, p in START_PRICES.items()}
        info = client.get("/reference").json()
        assert info["source"] == "snapshot" and info["as_of"] == "2000-01-01"
        assert info["prices"] == START_PRICES and info["live"] == []


def test_a_live_read_replaces_the_prices_and_the_engine_follows(engine):
    prices = {s: p for s, p in START_PRICES.items()}

    async def fetch(symbols):
        return dict(prices)

    with TestClient(create_app(settings_for(engine), reference_fetch=fetch)) as client:
        wait_for(lambda: client.get("/reference").json()["source"] == "yahoo")
        order(client, 1, "BUY", 18900, 10)           # a resting order at the old level
        prices["AAPL"] = 27000                         # Yahoo says $270.00 now
        wait_for(lambda: engine.reference.get(SYMBOL_IDS["AAPL"]) == 27000)
        assert client.get("/reference").json()["prices"]["AAPL"] == 27000
        # re-seeding cleared the stale level: two price levels never mix in one book
        assert client.get("/orderbook?symbol=AAPL").json()["bids"] == []
        assert (SYMBOL_IDS["AAPL"], 27000, 5) in engine.reference_calls
        # a price that did not change is not sent again
        sent = len(engine.reference_calls)
        time.sleep(0.6)
        assert len(engine.reference_calls) == sent


def test_orders_are_checked_against_the_reference_price(engine):
    with TestClient(create_app(settings_for(engine))) as client:
        wait_for(lambda: len(engine.reference) == len(ALL_SYMBOLS))
        # reference $189.50: 20 percent is $37.90, so $227.40 is the highest price and $151.60 the lowest
        too_high = order(client, 1, "BUY", 22800, 1)
        assert too_high.status_code == 409 and too_high.json()["detail"]["reason"] == "price_band"
        assert order(client, 1, "BUY", 22700, 1).status_code == 200
        assert order(client, 2, "SELL", 15100, 1).status_code == 409
        assert order(client, 2, "SELL", 15200, 1).status_code == 200


def test_a_failing_live_read_keeps_the_snapshot_prices(engine):
    async def broken(symbols):
        raise httpx.ConnectError("market-data is down")

    with TestClient(create_app(settings_for(engine), reference_fetch=broken)) as client:
        wait_for(lambda: len(engine.reference) == len(ALL_SYMBOLS))
        time.sleep(0.5)  # several refreshes have failed by now
        info = client.get("/reference").json()
        assert info["source"] == "snapshot" and info["prices"] == START_PRICES
        assert client.get("/health").json()["engine"] == "connected"


def test_a_partial_live_read_is_called_mixed(engine):
    async def fetch(symbols):
        return {"AAPL": 30000}

    with TestClient(create_app(settings_for(engine), reference_fetch=fetch)) as client:
        info = wait_for(lambda: (i := client.get("/reference").json())["source"] == "mixed" and i)
        assert info["live"] == ["AAPL"] and info["prices"]["AAPL"] == 30000 and info["prices"]["MSFT"] == 41000


def test_live_prices_are_saved_and_used_by_the_next_offline_start(engine, tmp_path):
    async def fetch(symbols):
        return {s: 10_000 + i for i, s in enumerate(ALL_SYMBOLS)}

    live = settings_for(engine, data_dir=str(tmp_path), reference_snapshot=None)
    with TestClient(create_app(live, reference_fetch=fetch)) as client:
        wait_for(lambda: (tmp_path / "reference_snapshot.json").exists())
    saved = json.loads((tmp_path / "reference_snapshot.json").read_text())
    assert saved["prices_cents"]["AAPL"] == 10_000

    offline = reference.load_snapshot(str(tmp_path))
    assert offline.source == "snapshot" and offline.prices["AAPL"] == 10_000 and offline.prices["AMD"] == 10_009


def test_the_snapshot_shipped_with_the_code_is_complete():
    ref = reference.load_snapshot(None, None)
    assert ref.source == "snapshot" and ref.as_of
    assert set(ref.prices) == set(ALL_SYMBOLS) and all(p > 0 for p in ref.prices.values())
    assert ref.prices != START_PRICES  # real prices, not the old made-up ones


def test_market_data_fetch_reads_price_in_dollars_as_integer_cents():
    def handler(request: httpx.Request) -> httpx.Response:
        symbol = request.url.path.rsplit("/", 1)[-1]
        assert request.url.params["range"] == "1d"
        if symbol == "TSLA":
            return httpx.Response(404, json={"detail": "no data"})
        if symbol == "NVDA":
            return httpx.Response(200, json={"price": "n/a"})
        return httpx.Response(200, json={"price": 352.2049})

    fetch = reference.market_data_fetch("http://md.test", transport=httpx.MockTransport(handler))
    got = asyncio.run(fetch(list(ALL_SYMBOLS)))
    assert got["AAPL"] == 35220 and "TSLA" not in got and "NVDA" not in got and len(got) == len(ALL_SYMBOLS) - 2


def test_virtual_traders_quote_within_two_percent_of_the_reference():
    rng = random.Random(3)
    ref = {s: 35220 + i * 1000 for i, s in enumerate(ALL_SYMBOLS)}
    traders = make_traders(ref)
    seen = 0
    for _ in range(3000):
        made = make_order(rng.choice(traders), ref, rng)
        if made is None:
            continue
        symbol, _, price, _ = made
        assert abs(price - ref[symbol]) * 100 <= ref[symbol] * 2
        seen += 1
    assert seen > 1000
