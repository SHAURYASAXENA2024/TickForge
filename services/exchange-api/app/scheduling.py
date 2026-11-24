"""Dispatch order of the virtual traders, and stop / stop-limit orders.

Both live in exchange-api, in front of the engine. The engine's own matching stays price-time FIFO.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass


class RoundRobin:
    """Hands out the traders in a fixed cycle, so every trader gets a turn before any gets a second one."""

    def __init__(self, items: list) -> None:
        self._items = items
        self._next = 0
        self.turns = 0  # how many times take() has been called

    def peek(self):
        """The item the next take() will return, without advancing."""
        return self._items[self._next % len(self._items)]

    def take(self):
        item = self._items[self._next % len(self._items)]
        self._next += 1
        self.turns += 1
        return item


@dataclass
class StopOrder:
    stop_id: int
    trader_id: int
    symbol: str
    side: str
    stop_price: int  # cents: the trigger
    limit_price: int | None  # cents: None = stop (becomes an aggressive limit), else stop-limit
    qty: int


# A plain stop becomes a limit this far past the trigger so that it crosses the book but stays inside the engine's price band.
STOP_SLIPPAGE_BP = 500


class StopBook:
    """Held stop orders. A BUY stop fires when the last price is at or above its stop price, a SELL stop
    when it is at or below. Held in memory only: they are lost when exchange-api restarts."""

    def __init__(self) -> None:
        self._ids = itertools.count(1)
        self.orders: dict[int, StopOrder] = {}

    def add(self, trader_id: int, symbol: str, side: str, stop_price: int, limit_price: int | None, qty: int) -> StopOrder:
        stop = StopOrder(next(self._ids), trader_id, symbol, side, stop_price, limit_price, qty)
        self.orders[stop.stop_id] = stop
        return stop

    def cancel(self, stop_id: int) -> bool:
        return self.orders.pop(stop_id, None) is not None

    def triggered(self, symbol: str, price: int) -> list[StopOrder]:
        """Remove and return the stops of `symbol` that `price` fires, oldest first."""
        fired = [s for s in self.orders.values() if s.symbol == symbol and
                 (price >= s.stop_price if s.side == "BUY" else price <= s.stop_price)]
        for s in fired:
            del self.orders[s.stop_id]
        return fired

    @staticmethod
    def release_price(stop: StopOrder) -> int:
        """The limit price of the order sent to the engine when the stop fires."""
        if stop.limit_price is not None:
            return stop.limit_price
        factor = 10_000 + STOP_SLIPPAGE_BP if stop.side == "BUY" else 10_000 - STOP_SLIPPAGE_BP
        return max(1, stop.stop_price * factor // 10_000)
