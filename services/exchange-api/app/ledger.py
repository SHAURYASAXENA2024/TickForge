"""Trading activity from a trader's fills: FIFO lots, realized and unrealized P&L (integer cents).

Rules:
- Fills are processed oldest first. A fill that reduces the open position closes the oldest lots
  first (FIFO); whatever is left of it opens a new lot. Sells beyond the shares bought in the ledger
  open short lots, which later buys close the same way.
- A "trade" for win rate, best and worst is one closing fill: the sum of the P&L of the lots it closed.
  A trade wins when that P&L is above zero. Fills that only open a position are not trades yet.
- Unrealized P&L marks what is still open against the last price.
"""
from __future__ import annotations

from collections import deque


def compute_activity(fills: list[dict], last_price_cents: int | None) -> dict:
    """fills: dicts with side, price_cents, quantity, timestamp_ms, trade_id. Any order."""
    ordered = sorted(fills, key=lambda f: (f["timestamp_ms"], f["trade_id"]))
    lots: deque[list[int]] = deque()  # [signed quantity, price]: positive = long, negative = short
    bought = sold = bought_cost = sold_value = realized = 0
    results: list[int] = []
    for f in ordered:
        qty, price = f["quantity"], f["price_cents"]
        signed = qty if f["side"] == "BUY" else -qty
        if signed > 0:
            bought += qty
            bought_cost += qty * price
        else:
            sold += qty
            sold_value += qty * price
        remaining, closed_pnl, closed_any = signed, 0, False
        while remaining and lots and (lots[0][0] > 0) != (remaining > 0):
            lot = lots[0]
            take = min(abs(lot[0]), abs(remaining))
            # long lot closed by a sell: sell price - lot price; short lot closed by a buy: lot price - buy price
            closed_pnl += (price - lot[1]) * take if lot[0] > 0 else (lot[1] - price) * take
            closed_any = True
            lot[0] += -take if lot[0] > 0 else take
            remaining += -take if remaining > 0 else take
            if lot[0] == 0:
                lots.popleft()
        if closed_any:
            realized += closed_pnl
            results.append(closed_pnl)
        if remaining:
            lots.append([remaining, price])
    net = sum(lot[0] for lot in lots)
    unrealized = None
    if last_price_cents is not None:
        unrealized = sum((last_price_cents - lot[1]) * lot[0] for lot in lots)
    return {
        "fills": len(ordered),
        "bought": bought, "sold": sold, "net_position": net,
        "avg_buy_cents": round(bought_cost / bought) if bought else None,
        "avg_sell_cents": round(sold_value / sold) if sold else None,
        "realized_pnl_cents": realized,
        "unrealized_pnl_cents": unrealized,
        "closed_trades": len(results),
        "win_rate": (sum(1 for r in results if r > 0) / len(results)) if results else None,
        "best_trade_cents": max(results) if results else None,
        "worst_trade_cents": min(results) if results else None,
        "last_price_cents": last_price_cents,
        "simulated": True,
    }
