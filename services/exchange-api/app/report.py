"""Statistics for the Report tab, computed from the orders table and the trades in the database.
Nothing here is stored or invented. All money is integer cents and all values are simulated."""
from __future__ import annotations

import time
from collections import Counter

from app.ledger import compute_activity
from app.traders import MANUAL_ID

WINDOWS_MS = {"1m": 60_000, "5m": 300_000}
SESSION_START_MS = int(time.time() * 1000)
OUTCOMES = ("filled", "partial", "cancelled", "rejected", "open")
OUTCOME_OF = {"filled": "filled", "partially_filled": "partial", "cancelled": "cancelled",
              "rejected": "rejected", "open": "open"}


def window_start(window: str, now_ms: int) -> int:
    return now_ms - WINDOWS_MS[window] if window in WINDOWS_MS else SESSION_START_MS


def _top_with_other(counts: Counter, keep: int = 5) -> dict:
    ranked = counts.most_common()
    out = dict(ranked[:keep])
    rest = sum(n for _, n in ranked[keep:])
    if rest:
        out["Other"] = rest
    return out


def _trader_stats(trader_id: int, orders: list[dict], trades: list[dict]) -> dict:
    mine = [o for o in orders if o["trader_id"] == trader_id]
    fills_by_symbol: dict[str, list[dict]] = {}
    for t in trades:
        if trader_id in (t["buyer_id"], t["seller_id"]):
            fills_by_symbol.setdefault(t["symbol"], []).append({**t, "side": "BUY" if t["buyer_id"] == trader_id else "SELL"})
    realized, results_win, results_n = 0, 0, 0
    for symbol_fills in fills_by_symbol.values():
        act = compute_activity(symbol_fills, None)
        realized += act["realized_pnl_cents"]
        if act["closed_trades"]:
            results_n += act["closed_trades"]
            results_win += round(act["win_rate"] * act["closed_trades"])
    n_fills = sum(len(v) for v in fills_by_symbol.values())
    return {
        "orders": len(mine), "fills": n_fills,
        "fill_rate": (sum(1 for o in mine if o["filled"] > 0) / len(mine)) if mine else None,
        "buy_share": (sum(1 for o in mine if o["side"] == "BUY") / len(mine)) if mine else None,
        "win_rate": (results_win / results_n) if results_n else None,
        "realized_pnl_cents": realized,
    }


def _avg(values: list) -> float | None:
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def build_report(orders: list[dict], trades: list[dict], strategies: dict[int, str], scope: str,
                 window: str, now_ms: int) -> dict:
    """orders: rows of the orders table; trades: rows of the trades table; strategies: trader id -> strategy.
    scope: "all", "kapinza" or a trader id. window: "session", "5m" or "1m"."""
    start = window_start(window, now_ms)
    tid = None if scope == "all" else MANUAL_ID if scope == "kapinza" else int(scope)
    w_orders = [o for o in orders if start <= o["created_ms"] <= now_ms]
    w_trades = [t for t in trades if start <= t["timestamp_ms"] <= now_ms]
    s_orders = [o for o in w_orders if tid is None or o["trader_id"] == tid]
    s_trades = [t for t in w_trades if tid is None or tid in (t["buyer_id"], t["seller_id"])]

    outcome = Counter(OUTCOME_OF.get(o["status"], "open") for o in s_orders)
    report = {
        "scope": scope, "window": window, "snapshot_time": now_ms, "simulated": True,
        "totals": {
            "orders": len(s_orders), "fills": len(s_trades),
            "fill_rate": (sum(1 for o in s_orders if o["filled"] > 0) / len(s_orders)) if s_orders else None,
        },
        "buy_sell": {"buy": sum(1 for o in s_orders if o["side"] == "BUY"),
                     "sell": sum(1 for o in s_orders if o["side"] == "SELL")},
        "order_outcome": {k: outcome.get(k, 0) for k in OUTCOMES},
        "symbol_split": _top_with_other(Counter(o["symbol"] for o in s_orders)),
        "rejection_reasons": dict(Counter(o.get("reason") or "unknown" for o in s_orders if o["status"] == "rejected")),
        "strategy_mix": None, "profit_split": None,
    }
    if tid is None:
        mix: Counter = Counter()
        for t in s_trades:
            for pid in (t["buyer_id"], t["seller_id"]):
                mix[strategies.get(pid, "manual" if pid == MANUAL_ID else "unknown")] += 1
        report["strategy_mix"] = dict(mix)
        split = {"in_profit": 0, "at_loss": 0, "flat": 0}
        for pid in sorted({p for t in s_trades for p in (t["buyer_id"], t["seller_id"])}):
            pnl = _trader_stats(pid, [], s_trades)["realized_pnl_cents"]
            split["in_profit" if pnl > 0 else "at_loss" if pnl < 0 else "flat"] += 1
        report["profit_split"] = split

    kap = _trader_stats(MANUAL_ID, w_orders, w_trades)
    others = [_trader_stats(i, w_orders, w_trades) for i in strategies if i != MANUAL_ID]
    report["kapinza_profile"] = {
        "kapinza": {k: kap[k] for k in ("fill_rate", "buy_share", "win_rate", "realized_pnl_cents")},
        "average_of_traders": {
            "fill_rate": _avg([o["fill_rate"] for o in others]),
            "buy_share": _avg([o["buy_share"] for o in others]),
            "win_rate": _avg([o["win_rate"] for o in others]),
            "realized_pnl_cents": _avg([o["realized_pnl_cents"] for o in others]),
        },
    }
    per_second = [0] * 60
    for o in orders:
        age = (now_ms - o["created_ms"]) // 1000
        if 0 <= age < 60 and (tid is None or o["trader_id"] == tid):
            per_second[59 - age] += 1
    report["orders_per_second"] = per_second  # oldest first, the last entry is the current second
    return report
