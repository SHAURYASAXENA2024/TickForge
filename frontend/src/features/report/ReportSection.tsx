// The Report tab: statistics computed by exchange-api from the orders table and the trades in the database.
// Everything is simulated (paper money, virtual traders). Charts are plain SVG.
import { useEffect, useRef, useState } from "react";
import { Badge, Notice, Panel, Segmented, Stat, buttonClass } from "@/components/ui";
import { getTraders, type Trader } from "@/lib/exchangeApi";
import {
  MIN_TRADES_FOR_REPORT, getReport, labelOf, money, percent, printHtml, ratio, slices,
  type Report, type ReportWindow, type Slice,
} from "@/lib/report";

const GAP = 1.2; // percent of the circle left empty between slices

export function Donut({ title, slices: items, emptyText = "No data yet" }: { title: string; slices: Slice[]; emptyText?: string }) {
  const total = items.reduce((a, s) => a + s.value, 0);
  const summary = items.map((s) => `${s.label} ${percent(s.value, total)}`).join(", ");
  let offset = 0;
  return (
    <div className="flex items-center gap-4 p-4" data-testid={`donut-${title}`}>
      {total === 0 ? (
        <div className="text-sm text-faint">{emptyText}</div>
      ) : (
        <>
          <svg viewBox="0 0 42 42" className="size-28 shrink-0 -rotate-90" role="img" aria-label={`${title}: ${summary}`}>
            {items.map((s) => {
              const share = (s.value / total) * 100;
              const len = items.length === 1 ? 100 : Math.max(share - GAP, 0.4);
              const el = (
                <circle key={s.key} cx="21" cy="21" r="15.915" fill="none" stroke={s.color} strokeWidth="6"
                  strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={-offset} />
              );
              offset += share;
              return el;
            })}
          </svg>
          <ul className="min-w-0 space-y-1 text-sm">
            {items.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
                <span className="truncate text-fg">{s.label}</span>
                <span className="ml-auto pl-2 font-mono text-muted">{s.value} · {percent(s.value, total)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function RateLine({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 300, h = 60;
  const pts = values.map((v, i) => `${((i / Math.max(values.length - 1, 1)) * w).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(" ");
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className="p-4">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" role="img" aria-label={`Orders per second over the last 60 seconds: ${total} orders, peak ${max} per second`} preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-1 text-xs text-muted">Last 60 seconds: {total} orders, peak {max} per second.</p>
    </div>
  );
}

const WINDOW_OPTIONS: { value: ReportWindow; label: string }[] = [
  { value: "session", label: "Session" }, { value: "5m", label: "5 min" }, { value: "1m", label: "1 min" },
];

export function ReportView({ report, error, scope, window: win, traders, onScope, onWindow, onDownload }: {
  report: Report | null; error: string; scope: string; window: ReportWindow; traders: Trader[];
  onScope: (s: string) => void; onWindow: (w: ReportWindow) => void; onDownload: () => void;
}) {
  const allScope = scope === "all";
  const enough = report !== null && report.totals.fills >= MIN_TRADES_FOR_REPORT;
  const k = report?.kapinza_profile;
  const inProfit = report?.profit_split;
  return (
    <div className="space-y-4 py-4" data-testid="report">
      <div className="flex flex-wrap items-center gap-3">
        <Badge kind="simulated" />
        <Segmented label="Scope" value={scope === "all" || scope === "kapinza" ? scope : ""} onChange={onScope}
          options={[{ value: "all", label: "All traders" }, { value: "kapinza", label: "Kapinza" }]} />
        <label className="flex items-center gap-2 text-xs text-muted">Virtual trader
          <select className="rounded-md border border-line-strong bg-canvas px-2 py-1 text-sm text-strong" value={scope === "all" || scope === "kapinza" ? "" : scope}
            onChange={(e) => e.target.value && onScope(e.target.value)}>
            <option value="">Choose…</option>
            {traders.map((t) => <option key={t.trader_id} value={String(t.trader_id)}>{t.name}</option>)}
          </select>
        </label>
        <Segmented label="Window" value={win} onChange={onWindow} options={WINDOW_OPTIONS} />
        <button type="button" className={`${buttonClass} ml-auto`} disabled={!report} onClick={onDownload}>Download report</button>
      </div>

      {error && <Notice tone="error" title="Report not available">{error}{report ? " Showing the last report received." : ""}</Notice>}
      {!report && !error && <Notice tone="loading" title="Loading the report">Waiting for exchange-api.</Notice>}

      {report && (
        <>
          <div className="grid grid-cols-2 divide-x divide-line rounded-lg border border-line bg-surface lg:grid-cols-4">
            <Stat label="Orders" value={String(report.totals.orders)} />
            <Stat label="Fills" value={String(report.totals.fills)} />
            <Stat label="Fill rate" value={ratio(report.totals.fill_rate)} />
            {allScope && inProfit
              ? <Stat label="Traders in profit" value={`${inProfit.in_profit} of ${inProfit.in_profit + inProfit.at_loss + inProfit.flat}`} />
              : <Stat label="Realized P&L" value={money(scope === "kapinza" ? k?.kapinza.realized_pnl_cents : null)} tone={(k?.kapinza.realized_pnl_cents ?? 0) < 0 ? "text-down" : "text-up"} live={scope === "kapinza"} />}
          </div>

          {!enough ? (
            <Notice tone="empty" title="Place more orders to see this report">
              This scope has {report.totals.fills} of the {MIN_TRADES_FOR_REPORT} fills needed in this window. Try a longer window or another scope.
            </Notice>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Panel title="Buy vs sell"><Donut title="Buy vs sell" slices={slices("buy_sell", report.buy_sell)} /></Panel>
              <Panel title="Order outcome"><Donut title="Order outcome" slices={slices("order_outcome", report.order_outcome)} /></Panel>
              <Panel title="Strategy mix" description="Fills by the strategy of each side">
                {report.strategy_mix ? <Donut title="Strategy mix" slices={slices("strategy_mix", report.strategy_mix)} /> : <p className="p-4 text-sm text-muted">Shown for all traders only</p>}
              </Panel>
              <Panel title="Symbol split" description="Orders, top 5 plus Other"><Donut title="Symbol split" slices={slices("symbol_split", report.symbol_split)} /></Panel>
              <Panel title="Traders in profit" description="By realized P&L">
                {report.profit_split ? <Donut title="Traders in profit" slices={slices("profit_split", report.profit_split)} /> : <p className="p-4 text-sm text-muted">Shown for all traders only</p>}
              </Panel>
              <Panel title="Rejection reasons"><Donut title="Rejection reasons" slices={slices("rejection_reasons", report.rejection_reasons)} emptyText="No rejected orders" /></Panel>
            </div>
          )}

          {k && (
            <Panel title="Kapinza profile" description="Kapinza next to the average of the 24 virtual traders in this window">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2 font-normal">Measure</th><th className="px-4 py-2 font-normal">Kapinza</th><th className="px-4 py-2 font-normal">Average of 24</th></tr></thead>
                <tbody className="divide-y divide-line font-mono">
                  <tr><td className="px-4 py-2 font-sans text-muted">Fill rate</td><td className="px-4 py-2">{ratio(k.kapinza.fill_rate)}</td><td className="px-4 py-2">{ratio(k.average_of_traders.fill_rate)}</td></tr>
                  <tr><td className="px-4 py-2 font-sans text-muted">Buy share</td><td className="px-4 py-2">{ratio(k.kapinza.buy_share)}</td><td className="px-4 py-2">{ratio(k.average_of_traders.buy_share)}</td></tr>
                  <tr><td className="px-4 py-2 font-sans text-muted">Win rate</td><td className="px-4 py-2">{ratio(k.kapinza.win_rate)}</td><td className="px-4 py-2">{ratio(k.average_of_traders.win_rate)}</td></tr>
                  <tr><td className="px-4 py-2 font-sans text-muted">Realized P&amp;L</td><td className="px-4 py-2">{money(k.kapinza.realized_pnl_cents)}</td><td className="px-4 py-2">{money(k.average_of_traders.realized_pnl_cents)}</td></tr>
                </tbody>
              </table>
            </Panel>
          )}

          <Panel title="Orders per second" description="Live, last 60 seconds"><RateLine values={report.orders_per_second} /></Panel>
          <p className="text-xs text-muted">Snapshot {new Date(report.snapshot_time).toLocaleTimeString()}. Window: {labelOf(report.window)}. All figures are simulated.</p>
        </>
      )}
    </div>
  );
}

/** Polls /report/summary every 2 s, keeps the last good reply on screen, and pauses while the page is hidden. */
export function useReport(scope: string, window: ReportWindow) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let controller: AbortController | null = null;
    const load = async () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await getReport(scope, window, controller.signal);
        if (!alive.current) return;
        setReport(next);
        setError("");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (alive.current) setError(e instanceof Error ? e.message : "The report could not be loaded.");
      }
    };
    void load();
    const timer = globalThis.setInterval(load, 2000);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive.current = false;
      controller?.abort();
      globalThis.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [scope, window]);
  return { report, error };
}

export default function ReportSection() {
  const [scope, setScope] = useState("all");
  const [win, setWin] = useState<ReportWindow>("session");
  const [traders, setTraders] = useState<Trader[]>([]);
  const { report, error } = useReport(scope, win);
  useEffect(() => { getTraders().then(setTraders).catch(() => undefined); }, []);
  const scopeLabel = scope === "all" ? "All traders" : scope === "kapinza" ? "Kapinza" : traders.find((t) => String(t.trader_id) === scope)?.name ?? `Trader ${scope}`;
  const download = () => {
    if (!report) return;
    const w = globalThis.open("", "_blank");
    if (!w) return;
    w.document.write(printHtml(report, scopeLabel));
    w.document.close();
    w.focus();
    w.print();
  };
  return <ReportView report={report} error={error} scope={scope} window={win} traders={traders} onScope={setScope} onWindow={setWin} onDownload={download} />;
}
