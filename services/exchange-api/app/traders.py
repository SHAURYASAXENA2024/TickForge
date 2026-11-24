"""The 24 virtual traders: accounts (integer cents) and a simple order generator.

All money is integer cents and all quantities are whole shares, so cash and shares are
exactly conserved: every fill moves price*qty cents and qty shares between two traders.

Resting orders do not reserve cash or shares, so if several of a trader's orders fill at
once its cash can dip below zero or its holdings below zero (a short position). The
generator checks the balance when it creates an order, which keeps this rare. Realized
P&L only counts shares the trader actually held.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from app.symbols import ALL_SYMBOLS

START_CASH = 100_000_000  # $1,000,000.00
START_SHARES = 500  # per symbol

QUOTE_BAND_BP = 200  # virtual traders quote within 2 percent of the reference price

STRATEGIES = ["aggressive", "passive", "random", "momentum", "contrarian", "scalper"]

# The manual trader: orders placed from the order ticket belong to this account.
MANUAL_ID = 25
MANUAL_NAME = "Kapinza"

NAMES = [
    "Arjun Mehta", "Priya Sharma", "Rahul Verma", "Sneha Gupta",
    "Vikram Singh", "Anil Kumar", "Deepa Nair", "Rohan Patel",
    "Kavya Reddy", "Suresh Iyer", "Meera Joshi", "Nikhil Rao",
    "Pooja Bansal", "Amit Choudhary", "Lakshmi Das", "Sanjay Kapoor",
    "Ananya Bose", "Kiran Pillai", "Manish Tiwari", "Swati Saxena",
    "Gaurav Malhotra", "Ritu Agarwal", "Varun Khanna", "Divya Menon",
]


@dataclass
class Trader:
    trader_id: int  # 1..24
    name: str
    strategy: str
    cash: int = START_CASH  # cents
    holdings: dict[str, int] = field(default_factory=dict)  # symbol -> shares
    cost: dict[str, int] = field(default_factory=dict)  # symbol -> total cost of held shares, cents
    realized_pnl: int = 0  # cents
    trades: int = 0
    last_action: str = ""

    def apply_fill(self, symbol: str, side: str, price: int, qty: int) -> None:
        """Move cash and shares for one fill and update realized P&L (average-cost method)."""
        value = price * qty
        held = self.holdings.get(symbol, 0)
        if side == "BUY":
            covering = min(qty, max(-held, 0))  # buying back a short position has no cost basis
            self.cash -= value
            self.holdings[symbol] = held + qty
            self.cost[symbol] = self.cost.get(symbol, 0) + price * (qty - covering)
        else:
            from_stock = min(qty, max(held, 0))
            cost_removed = self.cost.get(symbol, 0) * from_stock // held if from_stock else 0
            self.cash += value
            self.holdings[symbol] = held - qty
            self.cost[symbol] = self.cost.get(symbol, 0) - cost_removed
            self.realized_pnl += price * from_stock - cost_removed
        self.trades += 1

    def reset(self, prices: dict[str, int]) -> None:
        self.cash = START_CASH
        self.holdings = {s: START_SHARES for s in ALL_SYMBOLS}
        self.cost = {s: START_SHARES * prices[s] for s in ALL_SYMBOLS}
        self.realized_pnl = 0
        self.trades = 0
        self.last_action = ""

    def equity(self, prices: dict[str, int]) -> int:
        return self.cash + sum(qty * prices[s] for s, qty in self.holdings.items())

    def to_dict(self, prices: dict[str, int], account: dict | None = None) -> dict:
        """`account` is this trader's account as the engine reports it (cash, reserved_cash,
        shares and reserved_shares by symbol name). When given, it is the truth for balances."""
        cash, holdings = self.cash, self.holdings
        reserved_cash, reserved_shares = 0, {}
        if account is not None:
            cash, holdings = account["cash"], account["shares"]
            reserved_cash, reserved_shares = account["reserved_cash"], account["reserved_shares"]
        equity = cash + sum(qty * prices[s] for s, qty in holdings.items())
        return {
            "trader_id": self.trader_id,
            "name": self.name,
            "strategy": self.strategy,
            "cash": cash,
            "reserved_cash": reserved_cash,
            "available_cash": cash - reserved_cash,
            "holdings": {s: q for s, q in holdings.items() if q != 0},
            "reserved_shares": {s: q for s, q in reserved_shares.items() if q != 0},
            "realized_pnl": self.realized_pnl,
            "equity": equity,
            "trades": self.trades,
            "last_action": self.last_action,
        }


def make_manual_trader(prices: dict[str, int]) -> Trader:
    trader = Trader(MANUAL_ID, MANUAL_NAME, "manual")
    trader.reset(prices)
    return trader


def trader_name(trader_id: int) -> str:
    """Display name of a trader id; empty for 0 (unknown)."""
    if trader_id == MANUAL_ID:
        return MANUAL_NAME
    return NAMES[trader_id - 1] if 1 <= trader_id <= len(NAMES) else ""


def make_traders(prices: dict[str, int]) -> list[Trader]:
    traders = [Trader(i + 1, NAMES[i], STRATEGIES[i % len(STRATEGIES)]) for i in range(24)]
    for t in traders:
        t.reset(prices)
    return traders


# Each strategy: (side or None for random, how far from the last price in basis points,
# min qty, max qty). A buy at +bp is above the market, a sell at -bp is below it.
def _plan(strategy: str, rng: random.Random) -> tuple[str, int, int, int]:
    side = rng.choice(["BUY", "SELL"])
    sign = 1 if side == "BUY" else -1
    if strategy == "aggressive":  # crosses the spread
        return side, sign * 50, 50, 300
    if strategy == "passive":  # rests away from the market
        return side, -sign * 50, 10, 80
    if strategy == "momentum":
        return "BUY", 20, 20, 150
    if strategy == "contrarian":
        return "SELL", -20, 20, 150
    if strategy == "scalper":
        return side, rng.randint(-10, 10), 1, 30
    return side, rng.randint(-100, 100), 5, 200  # "random"


def make_order(trader: Trader, prices: dict[str, int], rng: random.Random, symbols: list[str] | None = None):
    """Return (symbol, side, price_cents, qty) for this trader, or None if it cannot trade."""
    symbol = rng.choice(symbols or ALL_SYMBOLS)
    side, bp, qty_min, qty_max = _plan(trader.strategy, rng)
    # Quote around the reference price, never further than 2 percent from it.
    price = max(1, prices[symbol] * (10_000 + max(-QUOTE_BAND_BP, min(QUOTE_BAND_BP, bp))) // 10_000)
    qty = rng.randint(qty_min, qty_max)

    if side == "SELL" and trader.holdings.get(symbol, 0) == 0:
        side = "BUY"  # nothing to sell: buy instead
    if side == "SELL":
        qty = min(qty, trader.holdings[symbol])
    else:
        qty = min(qty, max(0, trader.cash) * 8 // 10 // price)  # use at most 80% of the cash
    if qty <= 0:
        return None
    trader.last_action = f"{side} {qty} {symbol} @ {price / 100:.2f}"
    return symbol, side, price, qty
