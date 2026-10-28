"""
db_client.py — wrapper around the tickforge_db PyO3 native extension.

If the Rust .so is not built yet, falls back to an in-memory list so the
Exchange API can still run during development.
"""

from __future__ import annotations
import time
from typing import Any

_DB_AVAILABLE = False
_db_instance = None

try:
    # Built by: cd tickforge-db && maturin develop
    import tickforge_db  # type: ignore
    _DB_AVAILABLE = True
    print("[db_client] Rust LSM database loaded ✓")
except ImportError:
    print("[db_client] WARNING: tickforge_db native module not found — using in-memory fallback")


# ── Fallback in-memory store ───────────────────────────────────────────────

class _InMemoryDB:
    def __init__(self) -> None:
        self._trades: list[dict] = []
        self._next_id = 1

    def insert_trade(self, trade_id, trader_id, symbol, price_paise,
                     quantity, side, timestamp, buy_order_id, sell_order_id) -> bool:
        self._trades.append({
            "trade_id": trade_id,
            "trader_id": trader_id,
            "symbol": symbol,
            "price_paise": price_paise,
            "quantity": quantity,
            "side": side,
            "timestamp": timestamp,
            "buy_order_id": buy_order_id,
            "sell_order_id": sell_order_id,
        })
        return True

    def get_all_trades(self) -> list[dict]:
        return list(self._trades)

    def trade_count(self) -> int:
        return len(self._trades)


# ── Public API ─────────────────────────────────────────────────────────────

def get_db(wal_path: str = "data/wal.log") -> Any:
    """Return the singleton DB instance (Rust or in-memory)."""
    global _db_instance
    if _db_instance is None:
        if _DB_AVAILABLE:
            _db_instance = tickforge_db.TickForgeDB(wal_path)
        else:
            _db_instance = _InMemoryDB()
    return _db_instance


def insert_trade(
    trade_id: int,
    trader_id: int,
    symbol: str,
    price_paise: int,
    quantity: int,
    side: str,
    timestamp: int,
    buy_order_id: int,
    sell_order_id: int,
    wal_path: str = "data/wal.log",
) -> bool:
    db = get_db(wal_path)
    return db.insert_trade(
        trade_id, trader_id, symbol, price_paise,
        quantity, side, timestamp, buy_order_id, sell_order_id,
    )


def get_all_trades(wal_path: str = "data/wal.log") -> list[dict]:
    return get_db(wal_path).get_all_trades()
