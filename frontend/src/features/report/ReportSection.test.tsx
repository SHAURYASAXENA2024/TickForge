import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { printHtml, slices, colorFor, type Report } from "@/lib/report";
import { Donut, ReportView } from "./ReportSection";

const base: Report = {
  scope: "all", window: "session", snapshot_time: 1_700_000_000_000, simulated: true,
  totals: { orders: 40, fills: 30, fill_rate: 0.75 },
  buy_sell: { buy: 25, sell: 15 },
  order_outcome: { filled: 20, partial: 5, cancelled: 5, rejected: 0, open: 10 },
  symbol_split: { AAPL: 20, MSFT: 10, Other: 10 },
  rejection_reasons: {},
  strategy_mix: { aggressive: 10, passive: 20 },
  profit_split: { in_profit: 3, at_loss: 2, flat: 1 },
  kapinza_profile: {
    kapinza: { fill_rate: 0.5, buy_share: 0.6, win_rate: null, realized_pnl_cents: -1250 },
    average_of_traders: { fill_rate: 0.7, buy_share: 0.5, win_rate: 0.4, realized_pnl_cents: 300 },
  },
  orders_per_second: Array.from({ length: 60 }, (_, i) => i % 3),
};
const noop = () => undefined;
const view = (props: Partial<Parameters<typeof ReportView>[0]>) =>
  renderToString(<ReportView report={base} error="" scope="all" window="session" traders={[]} onScope={noop} onWindow={noop} onDownload={noop} {...props} />);

describe("Report view", () => {
  it("renders tiles, six charts, the Kapinza card and the Simulated label", () => {
    const html = view({});
    expect(html).toContain("SIMULATED");
    expect(html).toContain("3 of 6");
    for (const t of ["Buy vs sell", "Order outcome", "Strategy mix", "Symbol split", "Traders in profit", "Rejection reasons"]) expect(html).toContain(t);
    expect(html).toContain("63%");              // buy: 25 of 40 would be 62.5, shown rounded
    expect(html).toContain("-$12.50");
    expect(html).toContain("No rejected orders");
    expect(html).not.toContain("Rejected</span>");   // zero slice is not in the legend
    expect(html).toContain('aria-label="Orders per second');
  });
  it("shows a message when there are fewer than 10 fills", () => {
    const html = view({ report: { ...base, totals: { orders: 3, fills: 4, fill_rate: 0.5 } } });
    expect(html).toContain("Place more orders to see this report");
    expect(html).not.toContain("donut-Buy vs sell");
  });
  it("shows a readable error and the loading state, never undefined", () => {
    const err = view({ report: null, error: "The report could not be loaded: exchange-api is not reachable." });
    expect(err).toContain("exchange-api is not reachable");
    expect(view({ report: null })).toContain("Loading the report");
    expect(err).not.toContain("undefined");
  });
  it("says all-traders-only charts are limited for other scopes", () => {
    const html = view({ scope: "kapinza", report: { ...base, scope: "kapinza", strategy_mix: null, profit_split: null } });
    expect(html.match(/Shown for all traders only/g)?.length).toBe(2);
    expect(html).toContain("Realized P&amp;L");
  });
});

describe("report helpers", () => {
  it("omits zero slices and keeps colours tied to the key", () => {
    expect(slices("order_outcome", base.order_outcome).map((s) => s.key)).toEqual(["filled", "partial", "cancelled", "open"]);
    expect(colorFor("symbol_split", "AAPL")).toBe(colorFor("symbol_split", "AAPL"));
    expect(colorFor("buy_sell", "buy")).toBe("var(--up)");
    expect(colorFor("buy_sell", "sell")).toBe("var(--down)");
  });
  it("draws a full circle for a single slice", () => {
    expect(renderToString(<Donut title="x" slices={slices("buy_sell", { buy: 5, sell: 0 })} />)).toContain('stroke-dasharray="100 0"');
  });
  it("builds a print page with the timestamp and the Simulated label", () => {
    const html = printHtml(base, "All traders <b>");
    expect(html).toContain("Simulated");
    expect(html).toContain("Generated");
    expect(html).toContain("All traders &lt;b&gt;");
  });
});
