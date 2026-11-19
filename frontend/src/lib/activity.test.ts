import { describe, expect, it } from "vitest";
import { activityFields } from "./activity";
import type { Activity } from "./exchangeApi";

const base: Activity = { trader_id: 25, symbol: "AAPL", fills: 2, bought: 10, sold: 4, net_position: 6, avg_buy_cents: 19000, avg_sell_cents: 19500,
  realized_pnl_cents: 2000, unrealized_pnl_cents: -300, closed_trades: 1, win_rate: 1, best_trade_cents: 2000, worst_trade_cents: 2000, last_price_cents: 18950, simulated: true };

describe("activityFields", () => {
  it("formats the ten fields with signs and tones", () => {
    const f = Object.fromEntries(activityFields(base).map((x) => [x.label, x]));
    expect(f["Net position"].value).toBe("+6 sh");
    expect(f["Realized P&L"].tone).toBe("up");
    expect(f["Unrealized P&L"].tone).toBe("down");
    expect(f["Win rate"].value).toBe("100% of 1");
  });
  it("shows dashes for undefined values", () => {
    const f = Object.fromEntries(activityFields({ ...base, avg_sell_cents: null, win_rate: null, best_trade_cents: null }).map((x) => [x.label, x]));
    expect(f["Avg sell price"].value).toBe("–");
    expect(f["Win rate"].value).toBe("–");
    expect(f["Best trade"].value).toBe("–");
  });
});
