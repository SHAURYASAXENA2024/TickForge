"""
Pure analytics for the Journey view.

No network access in this module: it takes a price DataFrame and returns a plain dict,
so every number can be unit-tested against hand-calculated values.

Everything here is derived from price/volume bars. Yahoo does not publish who bought or
sold, so nothing in this module pretends to know that.
"""
from __future__ import annotations

import math
from typing import Any

import pandas as pd

MAX_LEGS = 8
MAX_SPIKES = 3
STORY_METHOD = "rule-based"
DATA_NOTE = "Prices from Yahoo Finance (via yfinance). They can be delayed by up to 15 minutes and are adjusted for splits and dividends."


def _is_intraday(interval: str) -> bool:
    return interval.endswith(("m", "h")) and not interval.endswith("mo")


def _label(ts: pd.Timestamp, intraday: bool) -> str:
    return ts.strftime("%H:%M %Z").strip() if intraday else ts.strftime("%b %d, %Y")


def _pct(start: float, end: float) -> float:
    return (end - start) / start * 100.0 if start else 0.0


def _money(value: float, currency: str) -> str:
    return f"${value:,.2f}" if currency == "USD" else f"{value:,.2f} {currency}"


def _signed(p: float) -> str:
    return f"{p:+.2f}%"


def _max_drawdown(closes: list[float]) -> tuple[float, int, int]:
    """Largest peak-to-trough fall. Returns (fraction <= 0, peak index, trough index)."""
    peak = 0
    best = (0.0, 0, 0)
    for i in range(1, len(closes)):
        if closes[i] > closes[peak]:
            peak = i
        drop = (closes[i] - closes[peak]) / closes[peak]
        if drop < best[0]:
            best = (drop, peak, i)
    return best


def _max_run_up(closes: list[float]) -> tuple[float, int, int]:
    """Largest trough-to-peak rise. Returns (fraction >= 0, trough index, peak index)."""
    trough = 0
    best = (0.0, 0, 0)
    for i in range(1, len(closes)):
        if closes[i] < closes[trough]:
            trough = i
        rise = (closes[i] - closes[trough]) / closes[trough]
        if rise > best[0]:
            best = (rise, trough, i)
    return best


def _zigzag(closes: list[float], threshold: float) -> list[int]:
    """Indices of swing turning points; a reversal must exceed `threshold` (a fraction)."""
    n = len(closes)
    if n < 2:
        return []
    pivots = [0]
    up: bool | None = None
    ext = 0
    for i in range(1, n):
        if up is None:
            if closes[i] >= closes[0] * (1 + threshold):
                up, ext = True, i
            elif closes[i] <= closes[0] * (1 - threshold):
                up, ext = False, i
        elif up:
            if closes[i] > closes[ext]:
                ext = i
            elif closes[i] <= closes[ext] * (1 - threshold):
                pivots.append(ext)
                up, ext = False, i
        else:
            if closes[i] < closes[ext]:
                ext = i
            elif closes[i] >= closes[ext] * (1 + threshold):
                pivots.append(ext)
                up, ext = True, i
    if up is None:
        return []
    if ext != pivots[-1]:
        pivots.append(ext)
    return pivots


def compute_journey(
    df: pd.DataFrame,
    interval: str,
    range_: str,
    previous_close: float | None = None,
    currency: str = "USD",
    year_high: float | None = None,
    year_low: float | None = None,
    symbol: str = "",
    actions: pd.DataFrame | None = None,
) -> dict[str, Any]:
    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    df = df[df["Close"] > 0]
    df["Volume"] = df["Volume"].fillna(0)
    if df.empty:
        raise ValueError("no usable bars")

    intraday = _is_intraday(interval)
    tz = str(df.index.tz) if getattr(df.index, "tz", None) is not None else "UTC"
    idx = list(df.index)
    opens = [float(v) for v in df["Open"]]
    highs = [float(v) for v in df["High"]]
    lows = [float(v) for v in df["Low"]]
    closes = [float(v) for v in df["Close"]]
    vols = [int(v) for v in df["Volume"]]
    n = len(closes)

    def at(i: int) -> dict[str, str]:
        return {"time": idx[i].isoformat(), "label": _label(idx[i], intraday)}

    def point(i: int, price: float) -> dict[str, Any]:
        return {"price": round(price, 4), **at(i)}

    first_open, last_close = opens[0], closes[-1]
    change = last_close - first_open
    change_pct = _pct(first_open, last_close)

    hi_i = max(range(n), key=lambda i: highs[i])
    lo_i = min(range(n), key=lambda i: lows[i])
    range_pct = _pct(lows[lo_i], highs[hi_i])

    gap_pct = None
    if range_ == "1d" and previous_close:
        gap_pct = round(_pct(previous_close, first_open), 4)

    # --- drawdown / run-up on closes -------------------------------------------------
    dd_frac, dd_peak, dd_trough = _max_drawdown(closes)
    max_dd = None
    if dd_frac < 0:
        rec = next((j for j in range(dd_trough + 1, n) if closes[j] >= closes[dd_peak]), None)
        max_dd = {
            "percent": round(dd_frac * 100, 4),
            "start": point(dd_peak, closes[dd_peak]),
            "end": point(dd_trough, closes[dd_trough]),
            "recovered": rec is not None,
            "recoveredAt": at(rec) if rec is not None else None,
        }
    ru_frac, ru_trough, ru_peak = _max_run_up(closes)
    max_ru = None
    if ru_frac > 0:
        max_ru = {
            "percent": round(ru_frac * 100, 4),
            "start": point(ru_trough, closes[ru_trough]),
            "end": point(ru_peak, closes[ru_peak]),
        }

    # --- bar-to-bar behaviour --------------------------------------------------------
    rets = [(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, n)]
    vol_pb = float(pd.Series(rets).std()) if len(rets) >= 2 else None  # sample std dev
    if vol_pb is not None and not math.isfinite(vol_pb):
        vol_pb = None
    best_up = max(range(len(rets)), key=lambda k: rets[k]) if rets else None
    best_dn = min(range(len(rets)), key=lambda k: rets[k]) if rets else None
    biggest_up = (
        {"percent": round(rets[best_up] * 100, 4), **at(best_up + 1)} if best_up is not None and rets[best_up] > 0 else None
    )
    biggest_dn = (
        {"percent": round(rets[best_dn] * 100, 4), **at(best_dn + 1)} if best_dn is not None and rets[best_dn] < 0 else None
    )
    bars = {
        "up": sum(1 for o, c in zip(opens, closes) if c > o),
        "down": sum(1 for o, c in zip(opens, closes) if c < o),
        "flat": sum(1 for o, c in zip(opens, closes) if c == o),
    }

    # --- volume ----------------------------------------------------------------------
    total_vol = sum(vols)
    avg_vol = total_vol / n
    spikes: list[dict[str, Any]] = []
    if n >= 10:
        std_v = float(pd.Series(vols).std())
        if math.isfinite(std_v) and std_v > 0:
            cutoff = avg_vol + 2 * std_v
            top = sorted((i for i in range(n) if vols[i] > cutoff), key=lambda i: vols[i], reverse=True)[:MAX_SPIKES]
            spikes = [
                {"volume": vols[i], "multiple": round(vols[i] / avg_vol, 2), **at(i), "_i": i} for i in sorted(top)
            ]
    vwap = None
    if total_vol > 0:
        vwap = round(sum(((h + l + c) / 3) * v for h, l, c, v in zip(highs, lows, closes, vols)) / total_vol, 4)

    # --- swings (legs) ---------------------------------------------------------------
    close_range = (max(closes) - min(closes)) / min(closes)
    threshold = max(0.005, 0.25 * close_range)  # a swing must be at least a quarter of the period's range
    pivots = _zigzag(closes, threshold)
    legs = []
    for a, b in zip(pivots, pivots[1:]):
        p = _pct(closes[a], closes[b])
        legs.append({"direction": "rise" if p > 0 else "fall", "percent": round(p, 4),
                     "start": point(a, closes[a]), "end": point(b, closes[b]), "_a": a, "_b": b})
    legs = sorted(sorted(legs, key=lambda L: abs(L["percent"]), reverse=True)[:MAX_LEGS], key=lambda L: L["_a"])

    # --- timeline (the rule-based "story") --------------------------------------------
    m = lambda v: _money(v, currency)  # noqa: E731
    word = "Day" if range_ == "1d" else "Period"
    events: list[tuple[int, int, dict[str, Any]]] = []  # (bar index, order within bar, event)
    open_text = f"Opened at {m(first_open)}"
    if gap_pct is not None:
        open_text += f", {'up' if gap_pct > 0 else 'down' if gap_pct < 0 else 'flat'} {abs(gap_pct):.2f}% from the previous close of {m(previous_close)}"
    events.append((0, 0, {"kind": "open", **at(0), "text": open_text + "."}))
    for L in legs:
        verb = "Rose" if L["direction"] == "rise" else "Fell"
        events.append((L["_a"], 1, {
            "kind": L["direction"], **at(L["_a"]), "endTime": idx[L["_b"]].isoformat(),
            "text": f"{verb} {abs(L['percent']):.2f}% from {m(L['start']['price'])} to {m(L['end']['price'])}, "
                    f"between {L['start']['label']} and {L['end']['label']}.",
        }))
    events.append((hi_i, 2, {"kind": "high", **at(hi_i), "text": f"{word} high of {m(highs[hi_i])}."}))
    events.append((lo_i, 2, {"kind": "low", **at(lo_i), "text": f"{word} low of {m(lows[lo_i])}."}))
    if spikes:
        s = max(spikes, key=lambda x: x["volume"])
        events.append((s["_i"], 3, {"kind": "volume", "time": s["time"], "label": s["label"],
                                    "text": f"Heaviest trading: {s['volume']:,} shares, {s['multiple']:.1f}x the average bar."}))
    events.append((n - 1, 4, {"kind": "close", **at(n - 1),
                              "text": f"Closed at {m(last_close)}, {_signed(change_pct)} for the period."}))
    timeline = [e for _, _, e in sorted(events, key=lambda t: (t[0], t[1]))]
    for L in legs:
        L.pop("_a"), L.pop("_b")
    for sp in spikes:
        sp.pop("_i")

    history = [
        {"timestamp": idx[i].isoformat(), "label": _label(idx[i], intraday), "open": round(opens[i], 4),
         "high": round(highs[i], 4), "low": round(lows[i], 4), "close": round(closes[i], 4), "volume": vols[i]}
        for i in range(n)
    ]

    result = {
        "symbol": symbol,
        "range": range_,
        "interval": interval,
        "timezone": tz,
        "currency": currency,
        "barCount": n,
        "periodStart": at(0),
        "periodEnd": at(n - 1),
        "open": round(first_open, 4),
        "close": round(last_close, 4),
        "change": round(change, 4),
        "changePercent": round(change_pct, 4),
        "high": point(hi_i, highs[hi_i]),
        "low": point(lo_i, lows[lo_i]),
        "rangePercent": round(range_pct, 4),
        "gapPercent": gap_pct,
        "maxDrawdown": max_dd,
        "maxRunUp": max_ru,
        "legs": legs,
        "biggestBar": {"up": biggest_up, "down": biggest_dn},
        "volume": {"total": total_vol, "averagePerBar": round(avg_vol, 2), "spikes": spikes},
        "vwap": vwap,
        "volatility": {"perBarPercent": round(vol_pb * 100, 4) if vol_pb is not None else None, "barLabel": interval},
        "bars": bars,
        "yearHigh": year_high,
        "yearLow": year_low,
        "timeline": timeline,
        "history": history,
        "storyMethod": STORY_METHOD,
        "dataNote": DATA_NOTE,
    }
    if range_ == "max":
        result["longTerm"] = compute_long_term(df, interval, currency, actions)
    return result


# ---- "since listing" block, only for range=max ------------------------------------------------------
DRAWDOWN_MIN_PERCENT = 20.0
MAX_DRAWDOWNS = 5


def compute_long_term(df: pd.DataFrame, interval: str, currency: str = "USD", actions: pd.DataFrame | None = None) -> dict[str, Any]:
    """Whole-listing summary from weekly or monthly bars. `actions` has optional columns
    "Dividends" and "Stock Splits" indexed by date (what yfinance calls Ticker.actions)."""
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    df = df[df["Close"] > 0]
    idx = list(df.index)
    opens, highs = [float(v) for v in df["Open"]], [float(v) for v in df["High"]]
    lows, closes = [float(v) for v in df["Low"]], [float(v) for v in df["Close"]]
    n = len(closes)

    def stamp(i: int) -> dict[str, str]:
        return {"time": idx[i].isoformat(), "label": _label(idx[i], False)}

    def point(i: int, price: float) -> dict[str, Any]:
        return {"price": round(price, 4), **stamp(i)}

    m = lambda v: _money(v, currency)  # noqa: E731
    first, last = opens[0], closes[-1]
    years = max((idx[-1] - idx[0]).days / 365.25, 0.0)
    cagr = ((last / first) ** (1 / years) - 1) * 100 if years >= 1 else None
    hi_i, lo_i = max(range(n), key=lambda i: highs[i]), min(range(n), key=lambda i: lows[i])

    # calendar years: close of the year against the close of the year before (the first year starts at the first open)
    year_rows: list[dict[str, Any]] = []
    by_year: dict[int, list[int]] = {}
    for i, ts in enumerate(idx):
        by_year.setdefault(ts.year, []).append(i)
    base = first
    for year, members in sorted(by_year.items()):
        end = closes[members[-1]]
        partial = (year == idx[0].year and idx[members[0]].day_of_year > 7) or (year == idx[-1].year and idx[members[-1]].day_of_year < 357)
        year_rows.append({"year": year, "percent": round(_pct(base, end), 4), "partial": bool(partial)})
        base = end
    full = [y for y in year_rows if not y["partial"]]
    best = max(full, key=lambda y: y["percent"]) if full else None
    worst = min(full, key=lambda y: y["percent"]) if full else None

    # falls of 20 percent or more, from a peak until the close is back at that peak
    episodes: list[dict[str, Any]] = []
    peak_i, trough_i = 0, 0
    for i in range(1, n):
        if closes[i] >= closes[peak_i]:
            if trough_i != peak_i:
                episodes.append({"peak": peak_i, "trough": trough_i, "rec": i})
            peak_i = trough_i = i
        elif closes[i] < closes[trough_i] or trough_i == peak_i:
            trough_i = i
    if trough_i != peak_i:
        episodes.append({"peak": peak_i, "trough": trough_i, "rec": None})
    deep = [e for e in episodes if _pct(closes[e["peak"]], closes[e["trough"]]) <= -DRAWDOWN_MIN_PERCENT]
    deep = sorted(sorted(deep, key=lambda e: _pct(closes[e["peak"]], closes[e["trough"]]))[:MAX_DRAWDOWNS], key=lambda e: e["peak"])
    drawdowns = [{
        "percent": round(_pct(closes[e["peak"]], closes[e["trough"]]), 4),
        "start": point(e["peak"], closes[e["peak"]]), "bottom": point(e["trough"], closes[e["trough"]]),
        "recovered": e["rec"] is not None, "recoveredAt": stamp(e["rec"]) if e["rec"] is not None else None,
        "daysToBottom": (idx[e["trough"]] - idx[e["peak"]]).days,
        "daysToRecover": (idx[e["rec"]] - idx[e["peak"]]).days if e["rec"] is not None else None,
    } for e in deep]

    splits: list[dict[str, Any]] = []
    dividends = {"count": 0, "totalPerShare": 0.0, "last": None, "byYear": []}
    if actions is not None and not actions.empty:
        stamps = [t.tz_convert(idx[0].tz) if idx[0].tzinfo and t.tzinfo else t for t in actions.index]
        if "Stock Splits" in actions:
            for t, v in zip(stamps, actions["Stock Splits"]):
                if v and float(v) > 0 and float(v) != 1.0:
                    j = next((k for k in range(n) if idx[k].date() >= t.date()), None)
                    if j is None:
                        continue
                    ratio = float(v)
                    text = f"{ratio:g}-for-1 split" if ratio > 1 else f"1-for-{1 / ratio:g} reverse split"
                    splits.append({"time": t.isoformat(), "label": t.strftime("%b %d, %Y"), "barTime": idx[j].isoformat(),
                                   "ratio": ratio, "text": f"{text} on {t.strftime('%b %d, %Y')}."})
        if "Dividends" in actions:
            paid = [(t, float(v)) for t, v in zip(stamps, actions["Dividends"]) if v and float(v) > 0]
            if paid:
                per_year: dict[int, float] = {}
                for t, v in paid:
                    per_year[t.year] = per_year.get(t.year, 0.0) + v
                lt, lv = paid[-1]
                dividends = {"count": len(paid), "totalPerShare": round(sum(v for _, v in paid), 4),
                             "last": {"time": lt.isoformat(), "label": lt.strftime("%b %d, %Y"), "amount": round(lv, 4)},
                             "byYear": [{"year": y, "amount": round(a, 4)} for y, a in sorted(per_year.items())]}

    bar_word = "monthly" if interval == "1mo" else "weekly"
    notes = [f"{n} {bar_word} bars from {idx[0].strftime('%b %d, %Y')} to {idx[-1].strftime('%b %d, %Y')}.",
             "Prices are adjusted for splits and dividends, so old prices look lower than they traded at the time.",
             f"Falls of {DRAWDOWN_MIN_PERCENT:.0f}% or more are listed, the {MAX_DRAWDOWNS} deepest at most."]
    return {
        "firstTraded": point(0, first), "yearsListed": round(years, 2),
        "totalReturnPercent": round(_pct(first, last), 4),
        "cagrPercent": round(cagr, 4) if cagr is not None else None,
        "growthOf1000": round(1000 * last / first, 2),
        "allTimeHigh": point(hi_i, highs[hi_i]), "allTimeLow": point(lo_i, lows[lo_i]),
        "fromAllTimeHighPercent": round(_pct(highs[hi_i], last), 4),
        "years": year_rows,
        "bestYear": best, "worstYear": worst, "drawdowns": drawdowns,
        "splits": splits, "dividends": dividends, "notes": notes,
    }
