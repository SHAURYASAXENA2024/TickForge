import { useEffect, useMemo, useState } from "react";
import { sp500 } from "./sp500";
import { getStockSnapshot, type StockSnapshot } from "./stockApi";

type IconName =
  | "activity"
  | "bolt"
  | "book"
  | "chevron"
  | "clock"
  | "cpu"
  | "database"
  | "layers"
  | "pause"
  | "play"
  | "reset"
  | "server"
  | "stop"
  | "traders";

const paths: Record<IconName, React.ReactNode> = {
  activity: <><path d="M3 12h4l2-7 4 14 2-7h6" /></>,
  bolt: <><path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
  chevron: <><path d="m9 18 6-6-6-6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  cpu: <><rect width="14" height="14" x="5" y="5" rx="2" /><path d="M9 9h6v6H9zM9 1v4m6-4v4M9 19v4m6-4v4M19 9h4m-4 6h4M1 9h4m-4 6h4" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
  layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
  pause: <><path d="M9 7v10M15 7v10" /></>,
  play: <><path d="m9 7 8 5-8 5V7Z" /></>,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  server: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></>,
  stop: <><rect x="7" y="7" width="10" height="10" rx="1" /></>,
  traders: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
};

function Icon({ name, size = "md" }: { name: IconName; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4";
  return (
    <svg className={sizeClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function Action({
  label,
  icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: IconName;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const handleKey = (event: React.KeyboardEvent) => {
    if (!disabled && (event.key === "Enter" || event.key === " ")) onClick();
  };
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onKeyDown={handleKey}
      className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition ${
        active
          ? "border-emerald-400 bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-950"
          : disabled
            ? "cursor-not-allowed border-slate-800 bg-slate-900 text-slate-600"
            : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white"
      }`}
    >
      <Icon name={icon} size="sm" />
      {label}
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  icon,
  children,
  className = "",
  action,
}: {
  title: string;
  eyebrow: string;
  icon: IconName;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/10 ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-lg border border-slate-700 bg-slate-800 text-cyan-400">
            <Icon name={icon} />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-200">{title}</div>
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">{eyebrow}</div>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PriceChart({ snapshot }: { snapshot: StockSnapshot }) {
  const points = snapshot.history;
  const closes = points.map((point) => point.close);
  const minimum = Math.min(...closes);
  const maximum = Math.max(...closes);
  const range = maximum - minimum || 1;
  const isPositive = snapshot.change >= 0;
  const linePoints = points
    .map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 92 - ((point.close - minimum) / range) * 82;
      return `${x},${y}`;
    })
    .join(" ");
  const areaPoints = `0,100 ${linePoints} 100,100`;
  const firstTime = points[0] ? new Date(points[0].timestamp) : null;
  const lastTime = points.at(-1) ? new Date(points.at(-1)!.timestamp) : null;

  return (
    <div>
      <div className="relative h-64 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60">
        <div className="pointer-events-none absolute inset-0 grid grid-rows-4 divide-y divide-slate-800/60">
          <span /><span /><span /><span />
        </div>
        <div className="absolute right-3 top-3 z-10 text-right font-mono">
          <div className="text-[9px] text-slate-600">SESSION HIGH</div>
          <div className="text-[10px] font-bold text-slate-400">{snapshot.currency} {maximum.toFixed(2)}</div>
        </div>
        <svg className="absolute inset-x-3 bottom-7 top-6 h-[calc(100%-3.25rem)] w-[calc(100%-1.5rem)] overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${snapshot.symbol} intraday price chart`}>
          <defs>
            <linearGradient id={`price-fill-${snapshot.symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? "var(--color-emerald-400)" : "var(--color-rose-400)"} stopOpacity="0.28" />
              <stop offset="100%" stopColor={isPositive ? "var(--color-emerald-400)" : "var(--color-rose-400)"} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={areaPoints} fill={`url(#price-fill-${snapshot.symbol})`} />
          <polyline points={linePoints} fill="none" stroke={isPositive ? "var(--color-emerald-400)" : "var(--color-rose-400)"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          {points.length > 0 && (
            <circle
              cx={points.length === 1 ? 50 : 100}
              cy={92 - ((points[points.length - 1].close - minimum) / range) * 82}
              r="2"
              fill={isPositive ? "var(--color-emerald-400)" : "var(--color-rose-400)"}
              stroke="var(--color-slate-950)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <div className="absolute inset-x-3 bottom-2 flex justify-between font-mono text-[9px] text-slate-600">
          <span>{firstTime?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <span>{lastTime?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] text-slate-600">
        <span>{points.length} real OHLCV samples</span>
        <span>Range {snapshot.currency} {minimum.toFixed(2)} — {maximum.toFixed(2)}</span>
      </div>
    </div>
  );
}

const traders = [
  { id: "VT-01", strategy: "Momentum", side: "BUY", position: "+0", dot: "bg-cyan-400" },
  { id: "VT-02", strategy: "Mean Reversion", side: "SELL", position: "+0", dot: "bg-violet-400" },
  { id: "VT-03", strategy: "Market Maker", side: "B / S", position: "+0", dot: "bg-amber-400" },
  { id: "VT-04", strategy: "Random", side: "BUY", position: "+0", dot: "bg-blue-400" },
  { id: "VT-05", strategy: "Momentum", side: "SELL", position: "+0", dot: "bg-emerald-400" },
  { id: "VT-06", strategy: "Market Maker", side: "B / S", position: "+0", dot: "bg-rose-400" },
];

const stages = [
  { label: "TRADER", meta: "VT-01", icon: "traders" as IconName },
  { label: "GATEWAY", meta: "API", icon: "server" as IconName },
  { label: "THREAD", meta: "T-04", icon: "cpu" as IconName },
  { label: "MPSC", meta: "QUEUE", icon: "layers" as IconName },
  { label: "MATCHER", meta: "C++", icon: "bolt" as IconName },
  { label: "BOOK", meta: "NIFTY", icon: "book" as IconName },
  { label: "TRADE", meta: "EVENT", icon: "activity" as IconName },
  { label: "WAL", meta: "RUST", icon: "database" as IconName },
  { label: "MEMTABLE", meta: "LSM", icon: "layers" as IconName },
];

const asks = [
  ["105.20", "100", "48%"],
  ["105.15", "250", "78%"],
  ["105.10", "200", "62%"],
];
const bids = [
  ["105.00", "150", "56%"],
  ["104.95", "80", "38%"],
  ["104.90", "220", "70%"],
];

const mvpCapabilities = [
  "Market clock",
  "Market open / close",
  "Start / stop / reset",
  "Virtual traders",
  "Basic strategies",
  "Order pipeline",
  "Real C++ matching engine",
  "MPSC queue",
  "Order book",
  "Trade visualization",
  "WAL",
  "MemTable",
  "Basic SSTables",
  "Basic metrics",
  "Basic architecture view",
  "CPU utilization",
];

const futureCapabilities = [
  "Thread / CPU mapping",
  "Detailed scheduler visualization",
  "CAS contention",
  "Order trace",
  "Detailed LSM internals",
  "Bloom filters / indexes",
  "Compaction visualization",
  "Stress testing",
  "Crash recovery",
  "Multi-instrument",
  "Engine sharding",
  "Replication",
  "Failover",
  "Candlestick charts",
  "Advanced trader analytics",
];

function App() {
  const [state, setState] = useState<"closed" | "running" | "paused" | "stopped">("closed");
  const [speed, setSpeed] = useState(10);
  const [seconds, setSeconds] = useState(0);
  const [activeStage, setActiveStage] = useState(-1);
  const [instrumentsOpen, setInstrumentsOpen] = useState(false);
  const [selectedSector, setSelectedSector] = useState("All sectors");
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [stockSnapshot, setStockSnapshot] = useState<StockSnapshot | null>(null);
  const [stockApiState, setStockApiState] = useState<"loading" | "online" | "error">("loading");
  const [stockApiError, setStockApiError] = useState("");

  useEffect(() => {
    if (state !== "running") return;
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
      setActiveStage((value) => (value + 1) % stages.length);
    }, Math.max(140, 1100 / speed));
    return () => window.clearInterval(timer);
  }, [state, speed]);

  useEffect(() => {
    let controller: AbortController | null = null;

    const loadStock = async () => {
      controller?.abort();
      controller = new AbortController();
      setStockApiState((current) => current === "online" ? current : "loading");
      try {
        const snapshot = await getStockSnapshot(selectedSymbol, controller.signal);
        setStockSnapshot(snapshot);
        setStockApiState("online");
        setStockApiError("");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStockSnapshot(null);
        setStockApiState("error");
        setStockApiError(error instanceof Error ? error.message : "Unable to reach stock API");
      }
    };

    loadStock();
    const poller = window.setInterval(loadStock, 15_000);
    return () => {
      controller?.abort();
      window.clearInterval(poller);
    };
  }, [selectedSymbol]);

  const marketTime = useMemo(() => {
    const total = 9 * 3600 + 30 * 60 + seconds * speed;
    const hours = Math.floor(total / 3600) % 24;
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return [hours, minutes, secs].map((part) => part.toString().padStart(2, "0")).join(":");
  }, [seconds, speed]);

  const reset = () => {
    setState("closed");
    setSeconds(0);
    setActiveStage(-1);
  };

  const online = state === "running" || state === "paused";
  const sectors = useMemo(
    () => ["All sectors", ...Array.from(new Set(sp500.map((stock) => stock.sector))).sort()],
    [],
  );
  const visibleStocks = useMemo(
    () => selectedSector === "All sectors" ? sp500 : sp500.filter((stock) => stock.sector === selectedSector),
    [selectedSector],
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-300 selection:bg-cyan-400/30">
      <div className="mx-auto max-w-[1800px] px-4 py-4 lg:px-6">
        <header className="mb-4 rounded-xl border border-slate-800 bg-slate-900/90 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-4 px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3">
              <div className="relative grid size-10 place-items-center overflow-hidden rounded-lg bg-cyan-400 text-slate-950">
                <Icon name="activity" size="lg" />
                <div className="absolute inset-x-0 bottom-0 h-1 bg-emerald-400" />
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <div className="text-lg font-black tracking-tight text-white">TICKFORGE</div>
                  <div className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">MVP</div>
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Exchange systems digital twin</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-center">
              <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono">
                <span className="text-xs text-slate-500">2026-10-05</span>
                <span className="text-sm font-bold tabular-nums text-white">{marketTime}</span>
              </div>
              <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${online ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-slate-700 bg-slate-800 text-slate-400"}`}>
                <span className={`size-2 rounded-full ${state === "running" ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
                MARKET {state === "running" ? "OPEN" : state === "paused" ? "PAUSED" : "CLOSED"}
              </div>
              <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                {[1, 10, 100].map((value) => (
                  <div
                    key={value}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSpeed(value)}
                    onKeyDown={(event) => event.key === "Enter" && setSpeed(value)}
                    className={`cursor-pointer rounded px-2.5 py-1.5 text-[11px] font-bold transition ${speed === value ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
                  >
                    {value}x
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Action label="Start" icon="play" active={state === "running"} onClick={() => setState("running")} />
              <Action label="Pause" icon="pause" disabled={state !== "running"} onClick={() => setState("paused")} />
              <Action label="Stop" icon="stop" disabled={!online} onClick={() => setState("stopped")} />
              <Action label="Reset" icon="reset" onClick={reset} />
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-2 text-[10px]">
            <span className="size-1.5 rounded-full bg-amber-400" />
            <span className="font-bold uppercase tracking-wider text-amber-400">Telemetry bridge</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-500">Awaiting engine connection · ws://localhost:9001</span>
          </div>
        </header>

        <div className="grid grid-cols-12 gap-4">
          <Panel title="Virtual Traders" eyebrow="Workload generators · 6" icon="traders" className="col-span-12 xl:col-span-3">
            <div className="grid grid-cols-[1fr_auto_auto] border-b border-slate-800 px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-slate-600">
              <span>Trader / Strategy</span><span>Intent</span><span className="ml-5">Position</span>
            </div>
            <div className="divide-y divide-slate-800/80">
              {traders.map((trader) => (
                <div key={trader.id} className="grid grid-cols-[1fr_auto_auto] items-center px-4 py-2.5 transition hover:bg-slate-800/40">
                  <div className="flex items-center gap-2.5">
                    <span className={`size-1.5 rounded-full ${online ? `${trader.dot} animate-pulse` : "bg-slate-600"}`} />
                    <div>
                      <div className="font-mono text-[11px] font-bold text-slate-200">{trader.id}</div>
                      <div className="text-[10px] text-slate-500">{trader.strategy}</div>
                    </div>
                  </div>
                  <span className={`rounded border px-1.5 py-1 font-mono text-[9px] font-bold ${trader.side === "BUY" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : trader.side === "SELL" ? "border-rose-500/20 bg-rose-500/10 text-rose-400" : "border-slate-700 bg-slate-800 text-slate-400"}`}>{trader.side}</span>
                  <span className="ml-5 font-mono text-[11px] text-slate-400">{trader.position}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 border-t border-slate-800 bg-slate-950/40">
              {[["ORDERS", "—"], ["BUYS", "—"], ["SELLS", "—"]].map(([label, value]) => (
                <div key={label} className="border-r border-slate-800 px-3 py-2.5 text-center last:border-r-0">
                  <div className="font-mono text-sm font-bold text-slate-300">{value}</div>
                  <div className="text-[9px] font-bold tracking-wider text-slate-600">{label}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Live Order Trace"
            eyebrow="End-to-end event pipeline"
            icon="activity"
            className="col-span-12 xl:col-span-9"
            action={<div className="flex items-center gap-2 rounded-md bg-slate-950 px-2.5 py-1.5 font-mono text-[10px] text-slate-500"><span className="size-1.5 rounded-full bg-cyan-400" /> TRACE MODE</div>}
          >
            <div className="p-4">
              <div className="mb-4 flex items-center justify-between rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="rounded bg-cyan-400/10 px-2 py-1 font-mono text-xs font-black text-cyan-400">ORD—PENDING</div>
                  <div className="font-mono text-xs text-slate-400">
                    <span className="font-bold text-emerald-400">BUY</span> 100 {selectedSymbol} @ $105.00
                  </div>
                </div>
                <div className="hidden font-mono text-[10px] text-slate-600 sm:block">Waiting for telemetry event</div>
              </div>

              <div className="relative overflow-x-auto pb-2">
                <div className="absolute left-8 right-8 top-7 h-px bg-slate-700" />
                <div className={`absolute left-8 top-7 h-px bg-cyan-400 transition-all duration-500 ${activeStage < 0 ? "w-0" : activeStage === stages.length - 1 ? "right-8" : ""}`} style={activeStage >= 0 && activeStage < stages.length - 1 ? { width: `${(activeStage / (stages.length - 1)) * 90}%` } : undefined} />
                <div className="relative grid min-w-[850px] grid-cols-9 gap-2">
                  {stages.map((stage, index) => {
                    const active = index === activeStage;
                    const complete = activeStage >= 0 && index < activeStage;
                    return (
                      <div key={stage.label} className="flex flex-col items-center text-center">
                        <div className={`grid size-14 place-items-center rounded-xl border-2 transition-all duration-300 ${active ? "scale-110 border-cyan-400 bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/30" : complete ? "border-cyan-500/50 bg-slate-900 text-cyan-400" : "border-slate-700 bg-slate-900 text-slate-500"}`}>
                          <Icon name={stage.icon} size="lg" />
                        </div>
                        <div className={`mt-2 text-[9px] font-black tracking-wide ${active ? "text-cyan-400" : "text-slate-400"}`}>{stage.label}</div>
                        <div className="mt-0.5 font-mono text-[9px] text-slate-600">{stage.meta}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 border-t border-slate-800 bg-slate-950/50 md:grid-cols-4">
              {[["TRACE ID", "Not assigned"], ["CURRENT STAGE", activeStage >= 0 ? stages[activeStage].label : "Idle"], ["ELAPSED", "— μs"], ["RESULT", "Awaiting event"]].map(([label, value]) => (
                <div key={label} className="border-r border-slate-800 px-4 py-3 last:border-r-0">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">{label}</div>
                  <div className="mt-1 font-mono text-[11px] font-semibold text-slate-300">{value}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="OS & Concurrency" eyebrow="Linux runtime telemetry" icon="cpu" className="col-span-12 lg:col-span-5 xl:col-span-3">
            <div className="grid grid-cols-2 gap-px bg-slate-800">
              {[["WORKER THREADS", "—", "Pinned cores"], ["CPU UTIL.", "—", "No sample"], ["QUEUE DEPTH", "—", "MPSC"], ["PUSH / POP", "—", "events/sec"]].map(([label, value, meta]) => (
                <div key={label} className="bg-slate-900 px-4 py-3">
                  <div className="text-[9px] font-bold tracking-wider text-slate-600">{label}</div>
                  <div className="mt-1 font-mono text-xl font-bold text-slate-200">{value}</div>
                  <div className="text-[9px] text-slate-500">{meta}</div>
                </div>
              ))}
            </div>
            <div className="space-y-3 px-4 py-3.5">
              {[["CAS Attempts", "—"], ["CAS Success", "—"], ["CAS Retries", "—"], ["Thread Affinity", "Awaiting /proc"]].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-mono font-semibold text-slate-300">{value}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Matching Engine" eyebrow={`Price-time priority · ${selectedSymbol}`} icon="book" className="col-span-12 lg:col-span-7 xl:col-span-5">
            <div className="grid grid-cols-[1fr_auto_1fr]">
              <div className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between text-[9px] font-bold uppercase tracking-wider">
                  <span className="text-rose-400">Sell / Ask</span><span className="text-slate-600">Qty</span>
                </div>
                <div className="space-y-1">
                  {asks.map(([price, qty, width]) => (
                    <div key={price} className="relative flex items-center justify-between overflow-hidden rounded px-2 py-1.5 font-mono text-[11px]">
                      <div className="absolute inset-y-0 right-0 bg-rose-500/10" style={{ width }} />
                      <span className="relative font-semibold text-rose-400">${price}</span><span className="relative text-slate-400">{qty}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="w-px bg-slate-800" />
              <div className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between text-[9px] font-bold uppercase tracking-wider">
                  <span className="text-emerald-400">Buy / Bid</span><span className="text-slate-600">Qty</span>
                </div>
                <div className="space-y-1">
                  {bids.map(([price, qty, width]) => (
                    <div key={price} className="relative flex items-center justify-between overflow-hidden rounded px-2 py-1.5 font-mono text-[11px]">
                      <div className="absolute inset-y-0 left-0 bg-emerald-500/10" style={{ width }} />
                      <span className="relative font-semibold text-emerald-400">${price}</span><span className="relative text-slate-400">{qty}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/50 px-4 py-3">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">Spread</div>
                <div className="font-mono text-xs font-bold text-amber-400">$0.10</div>
              </div>
              <div className="text-center">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">Last trade</div>
                <div className="font-mono text-xs font-bold text-slate-300">No trades</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">Matched</div>
                <div className="font-mono text-xs font-bold text-slate-300">—</div>
              </div>
            </div>
          </Panel>

          <Panel title="LSM Storage" eyebrow="Rust persistence engine" icon="database" className="col-span-12 xl:col-span-4">
            <div className="p-4">
              <div className="flex items-stretch gap-2">
                {[["WAL", "Write-ahead log", "database"], ["MEMTABLE", "In-memory", "layers"], ["SSTABLE", "On-disk", "server"]].map(([label, meta, icon], index) => (
                  <div className="contents" key={label}>
                    {index > 0 && <div className="flex items-center text-slate-700"><Icon name="chevron" size="sm" /></div>}
                    <div className="flex min-w-0 flex-1 flex-col items-center rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-3 text-center">
                      <div className="mb-2 grid size-8 place-items-center rounded bg-slate-800 text-violet-400"><Icon name={icon as IconName} /></div>
                      <div className="text-[9px] font-black tracking-wider text-slate-300">{label}</div>
                      <div className="mt-0.5 text-[9px] text-slate-600">{meta}</div>
                      <div className="mt-2 font-mono text-xs font-bold text-slate-400">—</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg border border-dashed border-slate-700 px-3 py-2 text-[10px]">
                <span className="text-slate-500">Compaction</span>
                <span className="font-mono text-slate-600">IDLE · FUTURE PHASE</span>
              </div>
            </div>
          </Panel>

          <section className="col-span-12 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-800 md:grid-cols-4 xl:grid-cols-8 xl:divide-y-0">
              {[["ORDERS / SEC", "—", "activity"], ["TRADES / SEC", "—", "bolt"], ["AVG LATENCY", "—", "clock"], ["P99 LATENCY", "—", "clock"], ["QUEUE DEPTH", "—", "layers"], ["CPU", "—", "cpu"], ["MEMORY", "—", "server"], ["CAS RETRIES", "—", "reset"]].map(([label, value, icon]) => (
                <div key={label} className="group px-4 py-3 transition hover:bg-slate-800/40">
                  <div className="mb-2 flex items-center justify-between text-slate-600 group-hover:text-cyan-400">
                    <Icon name={icon as IconName} size="sm" />
                    <span className="size-1.5 rounded-full bg-slate-700" />
                  </div>
                  <div className="font-mono text-lg font-black text-slate-300">{value}</div>
                  <div className="text-[9px] font-bold tracking-wider text-slate-600">{label}</div>
                </div>
              ))}
            </div>
          </section>

          <Panel
            title="System Architecture"
            eyebrow="MVP implementation boundary"
            icon="layers"
            className="col-span-12 xl:col-span-7"
          >
            <div className="border-b border-slate-800 p-4">
              <div className="flex min-w-0 items-stretch gap-2 overflow-x-auto pb-1">
                {[
                  ["C++ ENGINE", "Matching · MPSC", "cpu"],
                  ["RUST LSM", "WAL · MemTable", "database"],
                  ["TELEMETRY", "Events · Metrics", "activity"],
                  ["WEBSOCKET", "Control · Stream", "server"],
                  ["TICKFORGE UI", "Monitor only", "layers"],
                ].map(([label, meta, icon], index) => (
                  <div className="contents" key={label}>
                    {index > 0 && <div className="flex items-center text-slate-700"><Icon name="chevron" size="sm" /></div>}
                    <div className="min-w-32 flex-1 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-3">
                      <div className="mb-3 grid size-8 place-items-center rounded bg-slate-800 text-cyan-400"><Icon name={icon as IconName} /></div>
                      <div className="text-[9px] font-black tracking-wider text-slate-300">{label}</div>
                      <div className="mt-1 text-[9px] text-slate-600">{meta}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-px bg-slate-800 md:grid-cols-2">
              <div className="bg-slate-900 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400">MVP scope</div>
                  <div className="rounded bg-emerald-500/10 px-2 py-1 font-mono text-[9px] font-bold text-emerald-400">{mvpCapabilities.length} capabilities</div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {mvpCapabilities.map((capability) => (
                    <div key={capability} className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-[9px] font-black text-emerald-400">✓</span>
                      <span>{capability}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-slate-900 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[10px] font-black uppercase tracking-wider text-blue-400">Future roadmap</div>
                  <div className="rounded bg-blue-500/10 px-2 py-1 font-mono text-[9px] font-bold text-blue-400">{futureCapabilities.length} planned</div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {futureCapabilities.map((capability) => (
                    <div key={capability} className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="size-2 shrink-0 rounded-full bg-blue-400 shadow-sm shadow-blue-400" />
                      <span>{capability}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            title={`${selectedSymbol} Market Data`}
            eyebrow="Python stock API · 1 day / 5 minute interval"
            icon="activity"
            className="col-span-12"
            action={
              <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider ${
                stockApiState === "online"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                  : stockApiState === "loading"
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                    : "border-rose-500/20 bg-rose-500/10 text-rose-400"
              }`}>
                <span className={`size-1.5 rounded-full ${stockApiState === "online" ? "animate-pulse bg-emerald-400" : stockApiState === "loading" ? "animate-pulse bg-amber-400" : "bg-rose-400"}`} />
                API {stockApiState}
              </div>
            }
          >
            {stockSnapshot && stockSnapshot.history.length > 0 ? (
              <div className="grid gap-px bg-slate-800 lg:grid-cols-[1fr_2fr]">
                <div className="bg-slate-900 p-4">
                  <div className="mb-5">
                    <div className="flex items-baseline gap-2">
                      <div className="font-mono text-3xl font-black text-white">{stockSnapshot.currency} {stockSnapshot.price.toFixed(2)}</div>
                      <div className={`font-mono text-xs font-bold ${stockSnapshot.change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {stockSnapshot.change >= 0 ? "+" : ""}{stockSnapshot.change.toFixed(2)} ({stockSnapshot.changePercent.toFixed(2)}%)
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">Last update {new Date(stockSnapshot.updatedAt).toLocaleString()}</div>
                  </div>
                  <div className="space-y-3">
                    {[
                      ["Previous close", `${stockSnapshot.currency} ${stockSnapshot.previousClose.toFixed(2)}`],
                      ["Volume", stockSnapshot.volume.toLocaleString()],
                      ["Market state", stockSnapshot.marketState],
                      ["Data points", String(stockSnapshot.history.length)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between border-b border-slate-800 pb-2 text-[10px] last:border-0">
                        <span className="text-slate-500">{label}</span>
                        <span className="font-mono font-bold text-slate-300">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-900 p-4">
                  <PriceChart snapshot={stockSnapshot} />
                </div>
              </div>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
                <div className={`mb-4 grid size-12 place-items-center rounded-xl border ${stockApiState === "loading" ? "animate-pulse border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400"}`}>
                  <Icon name={stockApiState === "loading" ? "clock" : "server"} size="lg" />
                </div>
                <div className="text-xs font-bold text-slate-300">{stockApiState === "loading" ? `Loading ${selectedSymbol} market data` : "Python stock API unavailable"}</div>
                <div className="mt-2 max-w-xl text-[10px] leading-relaxed text-slate-500">
                  {stockApiState === "loading"
                    ? "Waiting for a valid quote and OHLCV history response."
                    : `${stockApiError}. Start the Python service or set VITE_STOCK_API_URL in your .env file.`}
                </div>
                <div className="mt-4 rounded-md bg-slate-950 px-3 py-2 font-mono text-[9px] text-slate-600">GET /api/stocks/{selectedSymbol}?range=1d&amp;interval=5m</div>
              </div>
            )}
          </Panel>

          <Panel
            title="S&P 500 Universe"
            eyebrow={`${sp500.length} current constituents · 11 sectors`}
            icon="book"
            className="col-span-12 xl:col-span-5"
            action={
              <div
                role="button"
                tabIndex={0}
                onClick={() => setInstrumentsOpen((value) => !value)}
                onKeyDown={(event) => event.key === "Enter" && setInstrumentsOpen((value) => !value)}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-slate-300 transition hover:border-slate-500"
              >
                {instrumentsOpen ? "Collapse list" : "Browse all stocks"}
                <span className={`transition-transform ${instrumentsOpen ? "rotate-90" : ""}`}><Icon name="chevron" size="sm" /></span>
              </div>
            }
          >
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/40 px-4 py-3">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">Active instrument</div>
                <div className="mt-0.5 font-mono text-lg font-black text-cyan-400">{selectedSymbol}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">Universe source</div>
                <div className="mt-1 text-[10px] text-slate-400">S&P 500 constituents dataset</div>
              </div>
            </div>
            {instrumentsOpen ? (
              <>
                <div className="flex gap-1.5 overflow-x-auto border-b border-slate-800 px-4 py-3">
                  {sectors.map((sector) => (
                    <div
                      key={sector}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedSector(sector)}
                      onKeyDown={(event) => event.key === "Enter" && setSelectedSector(sector)}
                      className={`shrink-0 cursor-pointer rounded-md border px-2 py-1.5 text-[9px] font-bold transition ${
                        selectedSector === sector
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-400"
                          : "border-slate-800 bg-slate-950 text-slate-500 hover:border-slate-600"
                      }`}
                    >
                      {sector}
                    </div>
                  ))}
                </div>
                <div className="grid max-h-80 grid-cols-1 overflow-y-auto sm:grid-cols-2">
                  {visibleStocks.map((stock) => (
                    <div
                      key={stock.symbol}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedSymbol(stock.symbol)}
                      onKeyDown={(event) => event.key === "Enter" && setSelectedSymbol(stock.symbol)}
                      className={`flex cursor-pointer items-center justify-between border-b border-slate-800/70 px-4 py-2.5 transition sm:odd:border-r ${
                        selectedSymbol === stock.symbol ? "bg-cyan-400/10" : "hover:bg-slate-800/40"
                      }`}
                    >
                      <div className="min-w-0 pr-3">
                        <div className={`font-mono text-[11px] font-black ${selectedSymbol === stock.symbol ? "text-cyan-400" : "text-slate-300"}`}>{stock.symbol}</div>
                        <div className="truncate text-[9px] text-slate-500">{stock.name}</div>
                      </div>
                      <div className="max-w-24 truncate rounded bg-slate-800 px-1.5 py-1 text-[8px] font-bold text-slate-500">{stock.sector}</div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-800 px-4 py-2 text-[9px] text-slate-600">
                  Showing {visibleStocks.length} instruments · Select a symbol to route it through the system view
                </div>
              </>
            ) : (
              <div className="grid grid-cols-3 gap-px bg-slate-800">
                {[
                  ["CONSTITUENTS", String(sp500.length)],
                  ["SECTORS", "11"],
                  ["SELECTION", selectedSymbol],
                ].map(([label, value]) => (
                  <div key={label} className="bg-slate-900 px-4 py-4 text-center">
                    <div className="font-mono text-lg font-black text-slate-300">{value}</div>
                    <div className="mt-1 text-[9px] font-bold tracking-wider text-slate-600">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <footer className="flex flex-col gap-2 px-1 py-3 text-[9px] font-medium uppercase tracking-wider text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>TickForge observability console · Controller isolated from matching path</span>
          <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-amber-400" /> Engine offline · Metrics intentionally withheld</span>
        </footer>
      </div>
    </main>
  );
}

export default App;
