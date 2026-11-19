import type { Activity } from "@/lib/exchangeApi";
import { DASH, dollars, fmtInt, signedDollars } from "@/lib/format";

/** The ten labelled values of the trading-activity panel. A dash means "not defined yet" (no sells, no closed trade). */
export function activityFields(a: Activity): { label: string; value: string; tone?: "up" | "down" }[] {
  const money = (c: number | null) => (c === null ? DASH : dollars(c));
  const pnl = (c: number | null) => (c === null ? { value: DASH } : { value: signedDollars(c), tone: c > 0 ? ("up" as const) : c < 0 ? ("down" as const) : undefined });
  return [
    { label: "Bought", value: `${fmtInt(a.bought)} sh` },
    { label: "Sold", value: `${fmtInt(a.sold)} sh` },
    { label: "Net position", value: `${a.net_position > 0 ? "+" : ""}${fmtInt(a.net_position)} sh` },
    { label: "Avg buy price", value: money(a.avg_buy_cents) },
    { label: "Avg sell price", value: money(a.avg_sell_cents) },
    { label: "Realized P&L", ...pnl(a.realized_pnl_cents) },
    { label: "Unrealized P&L", ...pnl(a.unrealized_pnl_cents) },
    { label: "Win rate", value: a.win_rate === null ? DASH : `${Math.round(a.win_rate * 100)}% of ${a.closed_trades}` },
    { label: "Best trade", ...pnl(a.best_trade_cents) },
    { label: "Worst trade", ...pnl(a.worst_trade_cents) },
  ];
}
