"""Price alerts: "tell me when SYMBOL goes above or below PRICE". Each alert fires once.

Kept in exchange-api and saved to `alerts.json` in the data directory (the same way the reference
snapshot is saved), so alerts survive a restart. Prices are integer cents. The engine is not involved.
"""
from __future__ import annotations

import json
import logging
import os
import time

log = logging.getLogger("exchange-api.alerts")
MAX_ALERTS = 100
MAX_PRICE_CENTS = 100_000_000
FILE_NAME = "alerts.json"


class AlertError(ValueError):
    pass


class AlertBook:
    def __init__(self, data_dir: str | None = None, symbols: set[str] | None = None) -> None:
        self.path = os.path.join(data_dir, FILE_NAME) if data_dir else None
        self.symbols = symbols or set()
        self.alerts: list[dict] = []
        self.next_id = 1
        self._load()

    def _load(self) -> None:
        if not self.path:
            return
        try:
            with open(self.path, encoding="utf-8") as fh:
                self.alerts = [a for a in json.load(fh) if isinstance(a, dict) and "alert_id" in a]
            self.next_id = max((a["alert_id"] for a in self.alerts), default=0) + 1
        except (OSError, ValueError):
            self.alerts = []

    def _save(self) -> None:
        if not self.path:
            return
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(self.alerts, fh)
            os.replace(tmp, self.path)
        except OSError:
            log.warning("could not save the alerts", exc_info=True)

    def add(self, symbol: str, direction: str, price_cents: int) -> dict:
        if self.symbols and symbol not in self.symbols:
            raise AlertError(f"unknown symbol {symbol}")
        if direction not in ("above", "below"):
            raise AlertError("direction must be above or below")
        if not isinstance(price_cents, int) or not 0 < price_cents <= MAX_PRICE_CENTS:
            raise AlertError("price must be greater than 0")
        if sum(1 for a in self.alerts if a["fired_ms"] is None) >= MAX_ALERTS:
            raise AlertError(f"at most {MAX_ALERTS} active alerts")
        alert = {"alert_id": self.next_id, "symbol": symbol, "direction": direction, "price_cents": price_cents,
                 "created_ms": int(time.time() * 1000), "fired_ms": None, "fired_price_cents": None}
        self.next_id += 1
        self.alerts.append(alert)
        self._save()
        return alert

    def remove(self, alert_id: int) -> bool:
        before = len(self.alerts)
        self.alerts = [a for a in self.alerts if a["alert_id"] != alert_id]
        if len(self.alerts) != before:
            self._save()
        return len(self.alerts) != before

    def check(self, symbol: str, price_cents: int, now_ms: int | None = None) -> list[dict]:
        """Fire every active alert of `symbol` that this price reaches. Returns the alerts that fired."""
        fired = []
        for a in self.alerts:
            if a["fired_ms"] is not None or a["symbol"] != symbol:
                continue
            if (a["direction"] == "above" and price_cents >= a["price_cents"]) or (
                    a["direction"] == "below" and price_cents <= a["price_cents"]):
                a["fired_ms"] = now_ms if now_ms is not None else int(time.time() * 1000)
                a["fired_price_cents"] = price_cents
                fired.append(a)
        if fired:
            self._save()
        return fired
