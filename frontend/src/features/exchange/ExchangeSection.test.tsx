import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DispatchInfo, Trader } from "@/lib/exchangeApi";

let current: DispatchInfo | undefined;
vi.mock("./useExchange", () => ({ useDispatchInfo: () => current }));
import { ExchangeSection } from "./ExchangeSection";

const t = (id: number, name: string) => ({ trader_id: id, name, strategy: "x", cash: 0, reserved_cash: 0, available_cash: 0, holdings: {}, reserved_shares: {}, realized_pnl: 0, equity: 0, trades: 0, last_action: "" }) as Trader;
const render = (d: DispatchInfo | undefined) => {
  current = d;
  return renderToString(<ExchangeSection online health={null} traders={[t(1, "Ada"), t(2, "Bo")]} trades={[]} />);
};

describe("Dispatch line and Next up badge", () => {
  it("round robin: shows the turn, the next trader and one badge", () => {
    const html = render({ mode: "roundrobin", next_trader_id: 2, turns: 5 });
    expect(html).toContain("Dispatch: round robin, turn 5, next up: Bo");
    expect(html.match(/Next up<\/span>/g)).toHaveLength(1);
    expect(html.indexOf("Next up</span>")).toBeGreaterThan(html.indexOf(">Bo<"));
  });
  it("random mode shows the plain line and no badge", () => {
    const html = render({ mode: "random", next_trader_id: null, turns: 0 });
    expect(html).toContain("Dispatch: random");
    expect(html).not.toContain("Next up</span>");
  });
  it("shows nothing extra when the field is missing", () => {
    const html = render(undefined);
    expect(html).not.toContain("Dispatch:");
    expect(html).not.toContain("Next up</span>");
  });
});
