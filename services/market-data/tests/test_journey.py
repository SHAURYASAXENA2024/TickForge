"""
Tests for the Journey analytics and API.
Run:  python -m pytest -q      (inside services/market-data/, with the repo .venv active)

Expected values are calculated by hand in the comments, not copied from the code's output.
The API tests use a fake provider; nothing here touches the network.
"""
import json
import statistics
import time

import pandas as pd
import pytest

from app import journey, stocks

# ---- fixture A: 10 five-minute bars, New York, 14 Oct 2026 --------------------------------------
#  idx:     0    1    2    3    4   5   6   7    8    9
C = [100, 102, 104, 101, 97, 95, 98, 103, 106, 105]
O = [100, 100, 102, 104, 101, 97, 96, 98, 103, 105]
V = [100] * 10
V[8] = 1000


def frame_a():
    idx = pd.date_range("2026-10-14 09:30", periods=10, freq="5min", tz="America/New_York")
    hi = [max(o, c) + 0.5 for o, c in zip(O, C)]
    lo = [min(o, c) - 0.5 for o, c in zip(O, C)]
    return pd.DataFrame({"Open": O, "High": hi, "Low": lo, "Close": C, "Volume": V}, index=idx).astype(
        {"Open": float, "High": float, "Low": float, "Close": float}
    )


def run_a(**kw):
    args = dict(interval="5m", range_="1d", previous_close=99.0, symbol="TEST")
    args.update(kw)
    return journey.compute_journey(frame_a(), **args)


def test_headline_numbers():
    j = run_a()
    assert j["open"] == 100 and j["close"] == 105
    assert j["change"] == 5 and j["changePercent"] == 5.0
    # highest High = 106.5 on bar 8 (10:10), lowest Low = 94.5 on bar 5 (09:55)
    assert (j["high"]["price"], j["high"]["label"]) == (106.5, "10:10 EDT")
    assert (j["low"]["price"], j["low"]["label"]) == (94.5, "09:55 EDT")
    assert j["rangePercent"] == pytest.approx((106.5 - 94.5) / 94.5 * 100, abs=1e-4)  # 12.6984
    assert j["gapPercent"] == pytest.approx((100 - 99) / 99 * 100, abs=1e-4)  # 1.0101
    assert j["timezone"] == "America/New_York" and j["barCount"] == 10


def test_drawdown_and_run_up():
    j = run_a()
    dd = j["maxDrawdown"]
    # peak close 104 (bar 2, 09:40) -> trough 95 (bar 5, 09:55): (95-104)/104 = -8.6538 %
    assert dd["percent"] == pytest.approx(-9 / 104 * 100, abs=1e-4)
    assert (dd["start"]["price"], dd["start"]["label"]) == (104, "09:40 EDT")
    assert (dd["end"]["price"], dd["end"]["label"]) == (95, "09:55 EDT")
    # first later close >= 104 is bar 8 (106) at 10:10
    assert dd["recovered"] is True and dd["recoveredAt"]["label"] == "10:10 EDT"
    ru = j["maxRunUp"]
    # trough close 95 (bar 5) -> peak close 106 (bar 8): 11/95 = 11.5789 %
    assert ru["percent"] == pytest.approx(11 / 95 * 100, abs=1e-4)
    assert (ru["start"]["label"], ru["end"]["label"]) == ("09:55 EDT", "10:10 EDT")


def test_unrecovered_drawdown():
    df = frame_a()
    df.loc[df.index[8:], "Close"] = [100.0, 99.0]  # never gets back to 104
    j = journey.compute_journey(df, "5m", "1d", symbol="T")
    assert j["maxDrawdown"]["recovered"] is False and j["maxDrawdown"]["recoveredAt"] is None


def test_legs_follow_the_zigzag():
    j = run_a()
    # swing threshold = 25 % of the close range (106-95)/95 = 2.89 %  -> pivots at bars 0, 2, 5, 8
    got = [(L["direction"], round(L["percent"], 4), L["start"]["label"], L["end"]["label"]) for L in j["legs"]]
    assert got == [
        ("rise", 4.0, "09:30 EDT", "09:40 EDT"),
        ("fall", round(-9 / 104 * 100, 4), "09:40 EDT", "09:55 EDT"),
        ("rise", round(11 / 95 * 100, 4), "09:55 EDT", "10:10 EDT"),
    ]


def test_bar_statistics():
    j = run_a()
    assert j["bars"] == {"up": 5, "down": 3, "flat": 2}
    # biggest close-to-close rise: bar 7 (98 -> 103) = 5.102 %, fall: bar 4 (101 -> 97) = -3.9604 %
    assert j["biggestBar"]["up"]["percent"] == pytest.approx(5 / 98 * 100, abs=1e-4)
    assert j["biggestBar"]["up"]["label"] == "10:05 EDT"
    assert j["biggestBar"]["down"]["percent"] == pytest.approx(-4 / 101 * 100, abs=1e-4)
    assert j["biggestBar"]["down"]["label"] == "09:50 EDT"
    rets = [(C[i] - C[i - 1]) / C[i - 1] for i in range(1, 10)]
    assert j["volatility"]["perBarPercent"] == pytest.approx(statistics.stdev(rets) * 100, abs=1e-4)


def test_volume_and_vwap():
    j = run_a()
    assert j["volume"]["total"] == 1900 and j["volume"]["averagePerBar"] == 190
    # mean 190, sample std 284.6 -> cutoff 759: only bar 8 (1000 shares) qualifies, 1000/190 = 5.26x
    assert [(s["label"], s["volume"], s["multiple"]) for s in j["volume"]["spikes"]] == [("10:10 EDT", 1000, 5.26)]
    hi = [max(o, c) + 0.5 for o, c in zip(O, C)]
    lo = [min(o, c) - 0.5 for o, c in zip(O, C)]
    expected = sum((h + l + c) / 3 * v for h, l, c, v in zip(hi, lo, C, V)) / sum(V)
    assert j["vwap"] == pytest.approx(expected, abs=1e-3)


def test_timeline_is_chronological_and_readable():
    j = run_a()
    assert [e["kind"] for e in j["timeline"]] == ["open", "rise", "fall", "rise", "low", "high", "volume", "close"]
    texts = {e["kind"]: e["text"] for e in j["timeline"]}
    assert texts["open"] == "Opened at $100.00, up 1.01% from the previous close of $99.00."
    assert texts["high"] == "Day high of $106.50."
    assert texts["low"] == "Day low of $94.50."
    assert texts["close"] == "Closed at $105.00, +5.00% for the period."
    fall = next(e for e in j["timeline"] if e["kind"] == "fall")
    assert fall["text"] == "Fell 8.65% from $104.00 to $95.00, between 09:40 EDT and 09:55 EDT."
    assert fall["time"].startswith("2026-10-14T09:40") and fall["endTime"].startswith("2026-10-14T09:55")


def test_daily_bars_use_dates_and_no_gap():
    idx = pd.date_range("2026-10-01", periods=5, freq="D", tz="America/New_York")
    df = pd.DataFrame({"Open": [10.0, 12, 14, 16, 18], "High": [11.0, 13, 15, 17, 19],
                       "Low": [9.0, 11, 13, 15, 17], "Close": [10.0, 12, 14, 16, 18], "Volume": [5, 5, 5, 5, 5]}, index=idx)
    j = journey.compute_journey(df, "1d", "5d", previous_close=9.0, symbol="T")
    assert j["periodStart"]["label"] == "Oct 01, 2026" and j["periodEnd"]["label"] == "Oct 05, 2026"
    assert j["gapPercent"] is None            # gap is only defined for a single-day view
    assert j["maxDrawdown"] is None           # never fell
    assert j["maxRunUp"]["percent"] == pytest.approx(80.0)
    assert [(L["direction"], L["percent"]) for L in j["legs"]] == [("rise", 80.0)]
    assert j["volume"]["spikes"] == []        # fewer than 10 bars: no spike detection
    assert next(e for e in j["timeline"] if e["kind"] == "high")["text"] == "Period high of $19.00."


def test_single_bar_does_not_crash():
    df = frame_a().iloc[:1]
    j = journey.compute_journey(df, "5m", "1d", symbol="T")
    assert j["barCount"] == 1 and j["maxDrawdown"] is None and j["maxRunUp"] is None
    assert j["volatility"]["perBarPercent"] is None and j["legs"] == []
    assert [e["kind"] for e in j["timeline"]] == ["open", "high", "low", "close"]


def test_bad_rows_are_dropped_and_zero_volume_has_no_vwap():
    df = frame_a()
    df.loc[df.index[3], "Close"] = float("nan")
    df["Volume"] = 0
    j = journey.compute_journey(df, "5m", "1d", symbol="T")
    assert j["barCount"] == 9 and j["vwap"] is None and j["volume"]["total"] == 0
    with pytest.raises(ValueError):
        journey.compute_journey(df.iloc[0:0], "5m", "1d")


def test_output_is_valid_json_without_nan():
    json.dumps(run_a(), allow_nan=False)


# ---- API ------------------------------------------------------------------------------------------
class FakeProvider:
    """Stands in for Yahoo. `calls` counts history requests so tests can see the cache working."""

    def __init__(self):
        self.calls = 0
        self.fail = False
        self.empty = False
        self.extras = {"currency": "USD", "year_high": 200.0, "year_low": 80.0}

    def history(self, symbol, period, interval):
        self.calls += 1
        if self.fail:
            raise RuntimeError("yahoo down")
        if self.empty:
            return pd.DataFrame()
        if (period, interval) == ("5d", "1d"):
            return pd.DataFrame({"Close": [99.0, 104.0]}, index=pd.date_range("2026-10-13", periods=2, tz="UTC"))
        return frame_a()

    def info(self, symbol):
        return self.extras


@pytest.fixture()
def fake():
    return FakeProvider()


@pytest.fixture()
def client(fake):
    from fastapi.testclient import TestClient
    from app import main

    original = stocks.provider
    stocks.set_provider(fake)
    stocks.cache.clear()
    yield TestClient(main.app)
    stocks.set_provider(original)


def test_api_journey_ok(client):
    r = client.get("/api/stocks/aapl/journey?range=1d")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "AAPL" and body["range"] == "1d" and body["interval"] == "5m"
    assert body["gapPercent"] == pytest.approx(1.0101, abs=1e-4)  # previous close 99 from the daily fake
    assert body["yearHigh"] == 200.0 and body["yearLow"] == 80.0
    assert len(body["history"]) == 10 and body["storyMethod"] == "rule-based"


def test_api_missing_year_range_is_null(client, fake):
    fake.extras = {}
    body = client.get("/api/stocks/AAPL/journey?range=6mo").json()
    assert body["yearHigh"] is None and body["yearLow"] is None and body["currency"] == "USD"


def test_api_rejects_bad_input(client, fake):
    assert client.get("/api/stocks/AAPL/journey?range=10y").status_code == 400
    assert client.get("/api/stocks/AAPL?range=1y&interval=5m").status_code == 400   # Yahoo would reject this pair
    assert client.get("/api/stocks/AAPL?range=1d&interval=1m").status_code == 400
    assert client.get("/api/stocks/bad%20sym!/journey").status_code == 400
    assert fake.calls == 0                                                            # nothing reached Yahoo


def test_api_not_found_and_provider_errors(client, fake):
    fake.empty = True
    assert client.get("/api/stocks/NOPE/journey?range=1d").status_code == 404
    fake.empty, fake.fail = False, True
    r = client.get("/api/stocks/AAPL/journey?range=1mo")
    assert r.status_code == 502 and "yahoo" not in r.text.lower()


def test_cache_serves_repeat_requests_and_is_bounded(client, fake):
    client.get("/api/stocks/AAPL/journey?range=1d")
    used = fake.calls
    client.get("/api/stocks/AAPL/journey?range=1d")
    assert fake.calls == used                            # second request came from the cache
    for i in range(stocks.CACHE_MAX_ENTRIES + 25):
        stocks.cache.put(("x", i), i)
    assert len(stocks.cache) <= stocks.CACHE_MAX_ENTRIES


def test_cache_entries_expire(monkeypatch):
    small = stocks.TTLCache(ttl=30, max_entries=5)
    now = [1000.0]
    monkeypatch.setattr(stocks.time, "monotonic", lambda: now[0])
    small.put("k", 1)
    assert small.get("k") == 1
    now[0] += 31
    assert small.get("k") is None


def test_slow_provider_call_times_out(monkeypatch):
    monkeypatch.setattr(stocks, "PROVIDER_TIMEOUT_SECONDS", 0.05)
    with pytest.raises(stocks.ProviderTimeout):
        stocks._with_timeout(lambda: time.sleep(0.5))


def test_existing_quote_endpoint_still_works(client):
    r = client.get("/api/stocks/AAPL?range=1d&interval=5m")
    assert r.status_code == 200 and r.json()["symbol"] == "AAPL" and len(r.json()["history"]) == 10


# ---- MAX: the whole listing ---------------------------------------------------------------------
def weekly_frame(closes, start="2020-01-06", freq="W-MON"):
    idx = pd.date_range(start, periods=len(closes), freq=freq, tz="America/New_York")
    c = [float(x) for x in closes]
    return pd.DataFrame({"Open": c, "High": [x + 1 for x in c], "Low": [x - 1 for x in c], "Close": c,
                         "Volume": [100] * len(c)}, index=idx)


def test_long_term_numbers_by_hand():
    # 5 yearly bars Jan 2020..2024 (Jan 6 + 52 weeks apart is close enough: use month starts instead)
    idx = pd.to_datetime(["2020-01-06", "2020-12-28", "2021-12-27", "2022-12-26", "2023-12-25"]).tz_localize("UTC")
    c = [100.0, 150.0, 90.0, 120.0, 180.0]
    df = pd.DataFrame({"Open": c, "High": [x + 5 for x in c], "Low": [x - 5 for x in c], "Close": c, "Volume": 1}, index=idx)
    actions = pd.DataFrame({"Dividends": [0.0, 0.5, 0.0], "Stock Splits": [0.0, 0.0, 2.0]},
                           index=pd.to_datetime(["2021-03-01", "2021-06-01", "2022-06-01"]).tz_localize("UTC"))
    lt = journey.compute_long_term(df, "1wk", "USD", actions)
    assert lt["totalReturnPercent"] == pytest.approx(80.0)            # 100 -> 180
    assert lt["growthOf1000"] == pytest.approx(1800.0)
    assert lt["yearsListed"] == pytest.approx(3.97, abs=0.01)
    assert lt["cagrPercent"] == pytest.approx(((1.8) ** (1 / 3.97) - 1) * 100, abs=0.1)
    assert lt["allTimeHigh"]["price"] == 185.0 and lt["allTimeLow"]["price"] == 85.0
    assert lt["fromAllTimeHighPercent"] == pytest.approx((180 - 185) / 185 * 100)
    # 2020 +50 (from the first open 100 to 150), 2021 -40, 2022 +33.33, 2023 +50
    assert [round(y["percent"], 2) for y in lt["years"]] == [50.0, -40.0, 33.33, 50.0]
    assert lt["worstYear"]["year"] == 2021 and lt["bestYear"]["percent"] == pytest.approx(50.0)
    # one fall: 150 -> 90 = -40%, recovered at 180 (the first close >= 150)
    d = lt["drawdowns"]
    assert len(d) == 1 and d[0]["percent"] == pytest.approx(-40.0) and d[0]["recovered"] is True
    assert d[0]["start"]["price"] == 150.0 and d[0]["bottom"]["price"] == 90.0
    assert lt["dividends"]["count"] == 1 and lt["dividends"]["totalPerShare"] == 0.5
    assert lt["dividends"]["byYear"] == [{"year": 2021, "amount": 0.5}]
    assert len(lt["splits"]) == 1 and lt["splits"][0]["ratio"] == 2.0 and lt["splits"][0]["text"].startswith("2-for-1")
    assert lt["splits"][0]["barTime"].startswith("2022-12-26")       # first bar on or after the split date


def test_long_term_without_actions_and_short_history():
    lt = journey.compute_long_term(weekly_frame([10, 11, 12]), "1wk")
    assert lt["cagrPercent"] is None and lt["splits"] == [] and lt["dividends"]["count"] == 0
    assert lt["drawdowns"] == [] and lt["bestYear"] is None


def test_compute_journey_adds_long_term_only_for_max():
    df = weekly_frame([100, 110, 105, 120])
    assert "longTerm" not in journey.compute_journey(df, "1wk", "1y", symbol="T")
    assert "longTerm" in journey.compute_journey(df, "1wk", "max", symbol="T")


class MaxProvider:
    def __init__(self, years):
        self.years, self.calls = years, []

    def history(self, symbol, period, interval):
        self.calls.append((period, interval))
        freq, per = ("W-MON", 52) if interval == "1wk" else ("MS", 12)
        n = int(self.years * per)
        if period == "5d":
            return pd.DataFrame({"Close": [99.0, 104.0]}, index=pd.date_range("2026-10-13", periods=2, tz="UTC"))
        return weekly_frame([100 + i % 50 for i in range(n)], "2000-01-03", freq)

    def info(self, symbol):
        return {"currency": "USD"}

    def actions(self, symbol):
        return pd.DataFrame()


def test_api_max_uses_weekly_bars_for_a_short_listing_and_monthly_for_a_long_one():
    from fastapi.testclient import TestClient
    from app import main

    original = stocks.provider
    try:
        for years, interval in ((10, "1wk"), (30, "1mo")):
            stocks.set_provider(MaxProvider(years))
            stocks.cache.clear()
            body = TestClient(main.app).get("/api/stocks/AAPL/journey?range=max").json()
            assert body["range"] == "max" and body["interval"] == interval and body["longTerm"]["years"]
    finally:
        stocks.set_provider(original)


@pytest.mark.parametrize("rng,interval", [("1d", "5m"), ("1mo", "1d"), ("6mo", "1d"), ("1y", "1d"), ("max", "1wk")])
def test_every_range_works_and_5d_is_gone(client, rng, interval):
    r = client.get(f"/api/stocks/AAPL/journey?range={rng}")
    assert r.status_code == 200 and r.json()["range"] == rng and r.json()["timeline"]
    assert client.get("/api/stocks/AAPL/journey?range=5d").status_code == 400
