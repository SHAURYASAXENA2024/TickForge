"""Ledger maths with hand-computed numbers (integer cents)."""
from app.ledger import compute_activity


def fill(i, side, price, qty):
    return {"trade_id": i, "timestamp_ms": i, "side": side, "price_cents": price, "quantity": qty}


def test_empty():
    a = compute_activity([], 1000)
    assert a["fills"] == 0 and a["net_position"] == 0 and a["win_rate"] is None
    assert a["unrealized_pnl_cents"] == 0 and a["avg_buy_cents"] is None


def test_fifo_lots_and_partial_close():
    # buy 10@100, buy 10@120, sell 15@130: closes 10@100 (+300) and 5@120 (+50) = +350
    a = compute_activity([fill(1, "BUY", 100, 10), fill(2, "BUY", 120, 10), fill(3, "SELL", 130, 15)], 125)
    assert (a["bought"], a["sold"], a["net_position"]) == (20, 15, 5)
    assert a["avg_buy_cents"] == 110 and a["avg_sell_cents"] == 130
    assert a["realized_pnl_cents"] == 350
    assert a["unrealized_pnl_cents"] == (125 - 120) * 5  # 5 left from the 120 lot
    assert a["closed_trades"] == 1 and a["win_rate"] == 1.0
    assert a["best_trade_cents"] == a["worst_trade_cents"] == 350


def test_losing_trade_and_win_rate():
    # win +100 (buy 10@100 sell 10@110), loss -50 (buy 5@100, sell 5@90)
    f = [fill(1, "BUY", 100, 10), fill(2, "SELL", 110, 10), fill(3, "BUY", 100, 5), fill(4, "SELL", 90, 5)]
    a = compute_activity(f, 100)
    assert a["realized_pnl_cents"] == 100 - 50 * 1 and a["net_position"] == 0
    assert a["win_rate"] == 0.5 and a["best_trade_cents"] == 100 and a["worst_trade_cents"] == -50
    assert a["unrealized_pnl_cents"] == 0  # flat position


def test_short_then_cover_and_flip():
    # sell 10@200 opens a short; buy 15@190 covers 10 (+100) and opens 5 long
    a = compute_activity([fill(1, "SELL", 200, 10), fill(2, "BUY", 190, 15)], 200)
    assert a["realized_pnl_cents"] == 100 and a["net_position"] == 5
    assert a["unrealized_pnl_cents"] == (200 - 190) * 5


def test_order_independent_input():
    f = [fill(2, "SELL", 110, 10), fill(1, "BUY", 100, 10)]
    assert compute_activity(f, None)["realized_pnl_cents"] == 100
    assert compute_activity(f, None)["unrealized_pnl_cents"] is None
