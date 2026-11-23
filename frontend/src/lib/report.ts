// Report tab data (GET /report/summary). Everything shown comes from this reply; all values are simulated.
import { EXCHANGE_URL } from "./exchangeApi";

export type ReportWindow = "session" | "5m" | "1m";
export type Rates = { fill_rate: number | null; buy_share: number | null; win_rate: number | null; realized_pnl_cents: number | null };

export type Report = {
  scope: string;
  window: ReportWindow;
  snapshot_time: number;
  simulated: true;
  totals: { orders: number; fills: number; fill_rate: number | null };
  buy_sell: { buy: number; sell: number };
  order_outcome: Record<string, number>;
  symbol_split: Record<string, number>;
  rejection_reasons: Record<string, number>;
  strategy_mix: Record<string, number> | null;
  profit_split: { in_profit: number; at_loss: number; flat: number } | null;
  kapinza_profile: { kapinza: Rates; average_of_traders: Rates };
  orders_per_second: number[];
};

export const MIN_TRADES_FOR_REPORT = 10;

export async function getReport(scope: string, window: ReportWindow, signal?: AbortSignal): Promise<Report> {
  let res: Response;
  try {
    res = await fetch(`${EXCHANGE_URL}/report/summary?trader=${encodeURIComponent(scope)}&window=${window}`, { signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error("The report could not be loaded: exchange-api is not reachable.");
  }
  if (!res.ok) throw new Error(`The report could not be loaded (exchange-api answered ${res.status}).`);
  const data = (await res.json()) as Report;
  if (!data || !data.totals || !data.buy_sell || !Array.isArray(data.orders_per_second)) throw new Error("The report reply was not in the expected shape.");
  return data;
}

export type Slice = { key: string; label: string; value: number; color: string };

const PALETTE = ["#60a5fa", "#f59e0b", "#22d3ee", "#f472b6", "#a78bfa", "#2dd4bf", "#fb923c", "#c084fc"];
const GREY = "#94a3b8";
const FIXED: Record<string, Record<string, string>> = {
  buy_sell: { buy: "var(--up)", sell: "var(--down)" },
  order_outcome: { filled: "var(--up)", partial: "#f59e0b", cancelled: GREY, rejected: "var(--down)", open: "#60a5fa" },
  profit_split: { in_profit: "var(--up)", at_loss: "var(--down)", flat: GREY },
  strategy_mix: { aggressive: "#f472b6", passive: "#60a5fa", random: "#94a3b8", momentum: "#22d3ee", contrarian: "#f59e0b", scalper: "#a78bfa", manual: "#2dd4bf" },
};

/** The same key always gets the same colour: fixed maps first, then a hash of the name (never the rank). */
export function colorFor(group: string, key: string): string {
  const fixed = FIXED[group]?.[key];
  if (fixed) return fixed;
  if (key === "Other") return GREY;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const LABEL: Record<string, string> = { in_profit: "In profit", at_loss: "At a loss", flat: "Flat", buy: "Buy", sell: "Sell" };
export const labelOf = (key: string) => LABEL[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Slices of one chart. Zero values are left out, so they never appear in a legend. */
export function slices(group: string, counts: Record<string, number> | null | undefined): Slice[] {
  return Object.entries(counts ?? {})
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ key, label: labelOf(key), value, color: colorFor(group, key) }));
}

export const percent = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : "0%");
export const ratio = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(0)}%`);
export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "n/a" : `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** A plain, print-friendly page for the "Download report" button. */
export function printHtml(r: Report, scopeLabel: string): string {
  const table = (title: string, group: string, counts: Record<string, number> | null) => {
    const rows = slices(group, counts);
    const total = rows.reduce((a, s) => a + s.value, 0);
    const body = rows.length
      ? rows.map((s) => `<tr><td>${esc(s.label)}</td><td>${s.value}</td><td>${percent(s.value, total)}</td></tr>`).join("")
      : `<tr><td colspan="3">${counts === null ? "Shown for all traders only" : "No data"}</td></tr>`;
    return `<h2>${esc(title)}</h2><table><tr><th>Item</th><th>Count</th><th>Share</th></tr>${body}</table>`;
  };
  const k = r.kapinza_profile;
  return `<!doctype html><html><head><meta charset="utf-8"><title>TickForge report</title><style>
body{font:14px sans-serif;margin:24px;color:#111}table{border-collapse:collapse;margin-bottom:12px}td,th{border:1px solid #999;padding:4px 10px;text-align:left}</style></head><body>
<h1>TickForge report <small>(Simulated)</small></h1>
<p>Generated ${esc(new Date(r.snapshot_time).toLocaleString())}. Scope: ${esc(scopeLabel)}. Window: ${esc(r.window)}. Paper money and simulated trades.</p>
<p>Orders ${r.totals.orders}, fills ${r.totals.fills}, fill rate ${ratio(r.totals.fill_rate)}.</p>
${table("Buy vs sell", "buy_sell", r.buy_sell)}${table("Order outcome", "order_outcome", r.order_outcome)}${table("Strategy mix", "strategy_mix", r.strategy_mix)}
${table("Symbol split", "symbol_split", r.symbol_split)}${table("Traders in profit", "profit_split", r.profit_split)}${table("Rejection reasons", "rejection_reasons", r.rejection_reasons)}
<h2>Kapinza and the average of the 24 traders</h2><table><tr><th></th><th>Kapinza</th><th>Average</th></tr>
<tr><td>Fill rate</td><td>${ratio(k.kapinza.fill_rate)}</td><td>${ratio(k.average_of_traders.fill_rate)}</td></tr>
<tr><td>Buy share</td><td>${ratio(k.kapinza.buy_share)}</td><td>${ratio(k.average_of_traders.buy_share)}</td></tr>
<tr><td>Win rate</td><td>${ratio(k.kapinza.win_rate)}</td><td>${ratio(k.average_of_traders.win_rate)}</td></tr>
<tr><td>Realized P&amp;L</td><td>${money(k.kapinza.realized_pnl_cents)}</td><td>${money(k.average_of_traders.realized_pnl_cents)}</td></tr></table>
</body></html>`;
}
