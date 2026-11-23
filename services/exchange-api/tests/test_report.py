"""Report statistics against a hand-computed fixture (all money in cents, times in ms)."""
import pytest

from app.report import build_report

NOW = 1_000_000_000
STRAT = {1: "aggressive", 2: "passive", 3: "random"}
STRAT_WITH_K = {**STRAT, 25: "manual"}


def o(oid, trader, side, symbol, status, filled, qty=10, age_s=100, reason=""):
    return {"order_id": oid, "trader_id": trader, "side": side, "symbol": symbol, "status": status,
            "filled": filled, "quantity": qty, "created_ms": NOW - age_s * 1000, "reason": reason}


def t(tid, buyer, seller, symbol, price, qty, age_s):
    return {"trade_id": tid, "symbol": symbol, "price_cents": price, "quantity": qty, "buyer_id": buyer,
            "seller_id": seller, "timestamp_ms": NOW - age_s * 1000, "buy_order_id": 0, "sell_order_id": 0}


# Orders: 1 BUY AAPL filled (trader 1), 2 SELL AAPL filled (trader 2), 3 BUY MSFT partial (trader 25),
# 4 SELL MSFT cancelled (25), 5 BUY TSLA rejected insufficient_cash (25), 6 BUY AAPL open (3, 30 s ago),
# 7 BUY AAPL filled (3, 400 s ago: outside 5m)
ORDERS = [
    o(1, 1, "BUY", "AAPL", "filled", 10, age_s=100), o(2, 2, "SELL", "AAPL", "filled", 10, age_s=100),
    o(3, 25, "BUY", "MSFT", "partially_filled", 4, age_s=50), o(4, 25, "SELL", "MSFT", "cancelled", 0, age_s=40),
    o(5, 25, "BUY", "TSLA", "rejected", 0, age_s=30, reason="insufficient_cash"),
    o(6, 3, "BUY", "AAPL", "open", 0, age_s=30), o(7, 3, "BUY", "AAPL", "filled", 10, age_s=400),
]
# Trades: T1 trader 1 buys 10 AAPL at 100 from trader 2 (100 s ago). T2 trader 1 sells 10 at 120 to trader 3
# (50 s ago): trader 1 realised +200, trader 2 has only a sell (opens a short, 0 realised), trader 3 only a buy.
TRADES = [t(1, 1, 2, "AAPL", 100, 10, 100), t(2, 3, 1, "AAPL", 120, 10, 50)]


def rep(**kw):
    args = dict(scope="all", window="session", now_ms=NOW)
    args.update(kw)
    return build_report(ORDERS, TRADES, STRAT_WITH_K, args["scope"], args["window"], args["now_ms"])


@pytest.fixture(autouse=True)
def long_session(monkeypatch):
    import app.report as r
    monkeypatch.setattr(r, "SESSION_START_MS", NOW - 10_000_000)


def test_all_traders_totals_and_split():
    r = rep()
    assert r["totals"] == {"orders": 7, "fills": 2, "fill_rate": 4 / 7}   # orders 1, 2, 3, 7 have fills
    assert r["buy_sell"] == {"buy": 5, "sell": 2}
    assert r["order_outcome"] == {"filled": 3, "partial": 1, "cancelled": 1, "rejected": 1, "open": 1}
    assert r["rejection_reasons"] == {"insufficient_cash": 1}
    assert r["symbol_split"] == {"AAPL": 4, "MSFT": 2, "TSLA": 1}


def test_strategy_mix_and_profit_split():
    r = rep()
    assert r["strategy_mix"] == {"aggressive": 2, "passive": 1, "random": 1}
    # trader 1 realised (120 - 100) * 10 = 200; traders 2 and 3 have no closed position
    assert r["profit_split"] == {"in_profit": 1, "at_loss": 0, "flat": 2}


def test_window_filter_uses_real_timestamps():
    r = rep(window="5m")
    assert r["totals"]["orders"] == 6          # order 7 is 400 s old
    r = rep(window="1m")
    assert r["totals"] == {"orders": 4, "fills": 1, "fill_rate": 1 / 4}   # orders 3, 4, 5, 6; only trade 2
    assert r["profit_split"] == {"in_profit": 0, "at_loss": 0, "flat": 2}


def test_kapinza_scope_and_profile():
    r = rep(scope="kapinza")
    assert r["totals"] == {"orders": 3, "fills": 0, "fill_rate": 1 / 3}
    assert r["buy_sell"] == {"buy": 2, "sell": 1}
    assert r["order_outcome"]["rejected"] == 1 and r["strategy_mix"] is None and r["profit_split"] is None
    k = r["kapinza_profile"]["kapinza"]
    assert k["fill_rate"] == 1 / 3 and k["buy_share"] == 2 / 3 and k["win_rate"] is None and k["realized_pnl_cents"] == 0
    avg = r["kapinza_profile"]["average_of_traders"]
    # fill rates: trader 1: 1/1, trader 2: 1/1, trader 3: 1/2
    assert avg["fill_rate"] == pytest.approx((1 + 1 + 0.5) / 3)
    assert avg["realized_pnl_cents"] == pytest.approx(200 / 3)
    assert avg["win_rate"] == 1.0                      # only trader 1 closed a trade, and it won


def test_single_trader_scope():
    r = rep(scope="1")
    assert r["totals"]["orders"] == 1 and r["totals"]["fills"] == 2


def test_orders_per_second_last_minute():
    r = rep()
    pps = r["orders_per_second"]
    assert len(pps) == 60 and sum(pps) == 4          # orders 3, 4, 5, 6 (50, 40, 30, 30 s ago)
    assert pps[59 - 30] == 2 and pps[59 - 40] == 1 and pps[59 - 50] == 1


def test_empty_data_has_no_division_errors():
    r = build_report([], [], STRAT_WITH_K, "all", "session", NOW)
    assert r["totals"] == {"orders": 0, "fills": 0, "fill_rate": None}
    assert r["profit_split"] == {"in_profit": 0, "at_loss": 0, "flat": 0}


def test_symbol_split_top_five_plus_other():
    orders = [o(i, 1, "BUY", s, "open", 0) for i, s in enumerate(["A", "B", "C", "D", "E", "F", "G", "A"], 1)]
    r = build_report(orders, [], STRAT, "all", "session", NOW)
    assert r["symbol_split"] == {"A": 2, "B": 1, "C": 1, "D": 1, "E": 1, "Other": 2}


def test_endpoint(client):
    client.post("/orders", json={"trader_id": 0, "symbol": "AAPL", "side": "BUY", "price": 19000, "qty": 5})
    r = client.get("/report/summary?trader=kapinza&window=1m").json()
    assert r["simulated"] is True and r["totals"]["orders"] >= 1
    assert client.get("/report/summary").status_code == 200
    assert client.get("/report/summary?window=2h").status_code == 422
    assert client.get("/report/summary?trader=99").status_code == 404
    assert client.get("/report/summary?trader=abc").status_code == 404
