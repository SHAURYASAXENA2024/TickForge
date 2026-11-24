"""Trade storage. Uses the Rust database `tickforge_db`; tests may use an in-memory stand-in."""
from __future__ import annotations

import logging
import os

from app.config import Settings

log = logging.getLogger("exchange-api.db")

_FIELDS = ("trade_id", "symbol", "price_cents", "quantity", "buy_order_id", "sell_order_id",
           "buyer_id", "seller_id", "timestamp_ms")
_STATUSES = ("open", "partially_filled", "filled", "cancelled", "rejected")


class MemoryDB:
    """Same methods as tickforge_db.TickForgeDB, for tests only (TICKFORGE_MEMORY_DB=1)."""

    def __init__(self) -> None:
        self._trades: dict[int, dict] = {}
        self._orders: dict[int, dict] = {}

    def insert_trade(self, buyer_name: str = "", seller_name: str = "", **fields) -> None:
        if set(fields) != set(_FIELDS):
            raise ValueError(f"expected exactly {_FIELDS}")
        self._trades[fields["trade_id"]] = {**fields, "buyer_name": buyer_name, "seller_name": seller_name}

    def trades_by_trader(self, trader_id: int, limit: int = 200) -> list[dict]:
        rows = [t for t in self._trades.values() if trader_id in (t["buyer_id"], t["seller_id"])]
        rows.sort(key=lambda t: (t["timestamp_ms"], t["trade_id"]), reverse=True)
        return rows[:limit]

    def upsert_order(self, order_id: int, trader_id: int, trader_name: str, side: str, symbol: str,
                     quantity: int, price_cents: int, status: str, filled: int, created_ms: int,
                     updated_ms: int, reason: str = "") -> None:
        if order_id <= 0 or side not in ("BUY", "SELL") or status not in _STATUSES or not 0 <= filled <= quantity:
            raise ValueError("bad order row")
        self._orders[order_id] = {
            "order_id": order_id, "trader_id": trader_id, "trader_name": trader_name, "side": side,
            "symbol": symbol, "quantity": quantity, "price_cents": price_cents, "status": status,
            "filled": filled, "created_ms": created_ms, "updated_ms": updated_ms, "reason": reason}

    def get_order(self, order_id: int):
        return self._orders.get(order_id)

    def list_orders(self, trader_id: int | None = None, limit: int = 100) -> list[dict]:
        rows = [o for o in self._orders.values() if trader_id is None or o["trader_id"] == trader_id]
        rows.sort(key=lambda o: o["order_id"], reverse=True)
        return rows[:limit]

    def order_count(self) -> int:
        return len(self._orders)

    def get_trade(self, trade_id: int):
        return self._trades.get(trade_id)

    def range(self, start_ms: int, end_ms: int, symbol: str | None = None) -> list[dict]:
        rows = [t for t in self._trades.values()
                if start_ms <= t["timestamp_ms"] < end_ms and (symbol is None or t["symbol"] == symbol)]
        return sorted(rows, key=lambda t: (t["timestamp_ms"], t["trade_id"]))

    def count(self) -> int:
        return len(self._trades)

    def flush(self) -> None:
        pass

    def compact(self) -> int:
        return 0


def open_db(settings: Settings):
    """Open the trade database. A missing tickforge_db module is a startup error."""
    if settings.memory_db:
        log.warning("using the in-memory trade store (TICKFORGE_MEMORY_DB=1): trades are not saved")
        return MemoryDB()
    try:
        from tickforge_db import TickForgeDB
    except ImportError as exc:
        raise RuntimeError(
            "tickforge_db is not installed. Build it with ./build.sh "
            "(or: maturin develop --release in storage/). "
            "For tests only you can set TICKFORGE_MEMORY_DB=1."
        ) from exc
    path = os.path.join(settings.data_dir, "trades-db")
    os.makedirs(path, exist_ok=True)
    log.info("trade database at %s", path)
    return TickForgeDB(path)
