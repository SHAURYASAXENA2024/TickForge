"""Reference prices: the real (Yahoo) price of each symbol, which the engine's price band and the
virtual traders' quotes are built around. Trades stay simulated; only the price level is real.

Where a price comes from, best first:
  1. market-data (port 8000), which reads Yahoo and caches it: `price` of the 1-day series is the
     last bar, so it is the last close when the market is closed. Yahoo is delayed up to 15 minutes.
  2. the snapshot file: the last prices this service saved (`<data dir>/reference_snapshot.json`),
     else the one shipped with the code (`app/reference_snapshot.json`).
Tests never touch the network: they pass their own fetch function and snapshot file.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable

import httpx

from app.symbols import ALL_SYMBOLS, START_PRICES

log = logging.getLogger("exchange-api.reference")

BUNDLED_SNAPSHOT = Path(__file__).with_name("reference_snapshot.json")
SNAPSHOT_NAME = "reference_snapshot.json"
FETCH_TIMEOUT = 5.0

# fetch(symbols) -> {symbol: price in cents} for the symbols it could read. It may raise.
Fetch = Callable[[list[str]], Awaitable[dict[str, int]]]


@dataclass
class ReferencePrices:
    prices: dict[str, int] = field(default_factory=lambda: dict(START_PRICES))  # cents
    source: str = "sample"  # "yahoo" (all live), "mixed" (some live), "snapshot" (saved file) or "sample"
    live: set[str] = field(default_factory=set)  # symbols whose price has been read live
    as_of: str = ""  # a date for a snapshot, an ISO time for a live read
    updated_ms: int = 0  # when this service last changed the prices


def _read_snapshot(path: Path) -> tuple[dict[str, int], str] | None:
    try:
        data = json.loads(path.read_text())
        prices = {s: int(p) for s, p in data["prices_cents"].items() if s in START_PRICES and int(p) > 0}
        return (prices, str(data.get("as_of", ""))) if prices else None
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def load_snapshot(data_dir: str | None = None, explicit: str | None = None) -> ReferencePrices:
    """The saved prices. An explicit file (tests) wins; otherwise the copy this service saved
    last time, then the bundled one. Symbols a file does not have keep the old sample price."""
    candidates = [Path(explicit)] if explicit else (
        [Path(data_dir) / SNAPSHOT_NAME] if data_dir else []) + [BUNDLED_SNAPSHOT]
    for path in candidates:
        found = _read_snapshot(path)
        if found:
            prices = dict(START_PRICES)
            prices.update(found[0])
            return ReferencePrices(prices=prices, source="snapshot", as_of=found[1], updated_ms=int(time.time() * 1000))
    log.warning("no reference price snapshot found; using the sample prices")
    return ReferencePrices()


def save_snapshot(data_dir: str, prices: dict[str, int]) -> None:
    """Remember live prices so the next offline start uses them, not older ones. Best effort."""
    try:
        os.makedirs(data_dir, exist_ok=True)
        tmp = Path(data_dir) / (SNAPSHOT_NAME + ".tmp")
        tmp.write_text(json.dumps({
            "source": "Yahoo Finance via market-data",
            "as_of": time.strftime("%Y-%m-%d", time.gmtime()),
            "prices_cents": prices,
        }, indent=2) + "\n")
        os.replace(tmp, Path(data_dir) / SNAPSHOT_NAME)
    except OSError:
        log.warning("could not save the reference price snapshot", exc_info=True)


def market_data_fetch(base_url: str, transport: httpx.AsyncBaseTransport | None = None) -> Fetch:
    """Read prices from market-data. A symbol that fails is left out; the others still count."""

    async def fetch(symbols: list[str]) -> dict[str, int]:
        async with httpx.AsyncClient(base_url=base_url, timeout=FETCH_TIMEOUT, transport=transport) as http:
            async def one(symbol: str) -> tuple[str, int | None]:
                try:
                    res = await http.get(f"/api/stocks/{symbol}", params={"range": "1d", "interval": "5m"})
                    res.raise_for_status()
                    cents = round(float(res.json()["price"]) * 100)  # dollars to integer cents, once
                    return symbol, cents if cents > 0 else None
                except (httpx.HTTPError, ValueError, KeyError, TypeError):
                    return symbol, None

            results = await asyncio.gather(*(one(s) for s in symbols))
        return {s: p for s, p in results if p is not None}

    return fetch


def new_reference(settings, fetch: Fetch | None) -> tuple[ReferencePrices, Fetch | None]:
    """The starting prices (from the snapshot) and the live fetch function, if live reads are on."""
    ref = load_snapshot(settings.data_dir, settings.reference_snapshot)
    if fetch is None and settings.reference_live:
        fetch = market_data_fetch(settings.market_data_url)
    return ref, fetch


async def refresh(ref: ReferencePrices, fetch: Fetch | None, data_dir: str, save: bool = True) -> bool:
    """Try one live read. Returns True if any price came from it. On failure the previous prices
    (live or snapshot) stay, and `source` says which they are."""
    if fetch is None:
        return False
    try:
        live = await fetch(list(ALL_SYMBOLS))
    except Exception as exc:  # a fetch function is allowed to fail in any way
        log.warning("reference prices: live read failed (%s); keeping the %s prices", exc, ref.source)
        return False
    live = {s: p for s, p in live.items() if s in ref.prices and p > 0}
    if not live:
        log.warning("reference prices: nothing came back; keeping the %s prices", ref.source)
        return False
    ref.prices.update(live)
    ref.live |= set(live)
    ref.source = "yahoo" if ref.live >= set(ref.prices) else "mixed"
    ref.as_of = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    ref.updated_ms = int(time.time() * 1000)
    if save and data_dir:
        save_snapshot(data_dir, ref.prices)
    return True
