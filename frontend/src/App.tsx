import { useEffect, useMemo, useRef, useState } from "react";
import { sp500 } from "./sp500";
import { scrollToSection, useActiveSection, useInView, useSmoothScroll } from "./scroll";
import { getStockSnapshot, StockApiError, type StockSnapshot } from "./stockApi";
import { TELEMETRY_URL, useTelemetry, type BookLevel } from "./telemetry";

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

type RunState = "closed" | "running" | "paused" | "stopped";

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
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-cyan-400 ${
        active
          ? "border-emerald-400 bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-950"
          : disabled
            ? "cursor-not-allowed border-slate-800 bg-slate-900 text-slate-600"
            : "cursor-pointer border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white"
      }`}
    >
      <Icon name={icon} size="sm" />
      {label}
    </button>
  );
}

const badgeStyles = {
  live: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  simulated: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  sample: "border-slate-600 bg-slate-800 text-slate-400",
  planned: "border-blue-500/30 bg-blue-500/10 text-blue-400",
} as const;

const badgeLabels = { live: "LIVE", simulated: "SIMULATED", sample: "SAMPLE DATA", planned: "PLANNED" } as const;

function Badge({ kind, label }: { kind: keyof typeof badgeStyles; label?: string }) {
  return (
    <span className={`rounded border px-1.5 py-1 font-mono text-[10px] font-bold tracking-wider ${badgeStyles[kind]}`}>
      {label ?? badgeLabels[kind]}
    </span>
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
  const [ref, shown] = useInView<HTMLElement>();
  return (
    <section
      ref={ref}
      className={`reveal ${shown ? "reveal-in" : ""} overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/10 backdrop-blur-sm ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-lg border border-slate-700 bg-slate-800 text-cyan-400">
            <Icon name={icon} />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-200">{title}</div>
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{eyebrow}</div>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function fmtUs(us: number): string {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(1)} s`;
  if (us >= 1000) return `${(us / 1000).toFixed(us >= 10_000 ? 0 : 1)} ms`;
  return `${us < 10 ? us.toFixed(1) : us.toFixed(0)} µs`;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString();

type ChartMode = "line" | "candles";

function PriceChart({ snapshot }: { snapshot: StockSnapshot }) {
  const [mode, setMode] = useState<ChartMode>("line");
  const [hover, setHover] = useState<{ index: number; frac: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const points = snapshot.history;
  const n = points.length;
  const isPositive = snapshot.change >= 0;
  const accent = isPositive ? "var(--color-emerald-400)" : "var(--color-rose-400)";

  const minimum = mode === "candles" ? Math.min(...points.map((p) => p.low)) : Math.min(...points.map((p) => p.close));
  const maximum = mode === "candles" ? Math.max(...points.map((p) => p.high)) : Math.max(...points.map((p) => p.close));
  const range = maximum - minimum || 1;
  const yOf = (value: number) => 92 - ((value - minimum) / range) * 82;

  const xLine = (index: number) => (n === 1 ? 50 : (index / (n - 1)) * 100);
  const xCandle = (index: number) => ((index + 0.5) / n) * 100;

  const linePoints = points.map((p, i) => `${xLine(i)},${yOf(p.close)}`).join(" ");
  const areaPoints = `0,100 ${linePoints} 100,100`;
  const firstTime = points[0] ? fmtTime(points[0].timestamp) : "";
  const lastTime = points[n - 1] ? fmtTime(points[n - 1].timestamp) : "";

  // The plot area is inset 12px on each side inside the box (inset-x-3).
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box || n === 0) return;
    const rect = box.getBoundingClientRect();
    const inner = rect.width - 24;
    if (inner <= 0) return;
    const frac = Math.min(1, Math.max(0, (event.clientX - rect.left - 12) / inner));
    const index = mode === "candles" ? Math.min(n - 1, Math.floor(frac * n)) : Math.round(frac * (n - 1));
    setHover({ index, frac: mode === "candles" ? (index + 0.5) / n : n === 1 ? 0.5 : index / (n - 1) });
  };

  const hovered = hover && points[hover.index] ? points[hover.index] : null;
  const lastClose = points[n - 1].close;

  return (
    <div>
      <div
        ref={boxRef}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        className="relative h-64 touch-pan-y overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60"
      >
        <div className="pointer-events-none absolute inset-0 grid grid-rows-4 divide-y divide-slate-800/60">
          <span /><span /><span /><span />
        </div>

        <div className="absolute left-3 top-3 z-20 flex rounded-md border border-slate-800 bg-slate-950/80 p-0.5">
          {(["line", "candles"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition ${mode === value ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="pointer-events-none absolute right-3 top-3 z-10 text-right font-mono">
          <div className="text-[10px] text-slate-600">SESSION HIGH</div>
          <div className="text-[11px] font-bold text-slate-400">{snapshot.currency} {maximum.toFixed(2)}</div>
        </div>

        <svg className="pointer-events-none absolute inset-x-3 bottom-7 top-10 h-[calc(100%-4.25rem)] w-[calc(100%-1.5rem)] overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${snapshot.symbol} intraday ${mode === "candles" ? "candlestick" : "price"} chart`}>
          {mode === "line" ? (
            <>
              <defs>
                <linearGradient id={`price-fill-${snapshot.symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={accent} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={areaPoints} fill={`url(#price-fill-${snapshot.symbol})`} />
              <polyline points={linePoints} fill="none" stroke={accent} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <circle cx={n === 1 ? 50 : 100} cy={yOf(lastClose)} r="2" fill={accent} stroke="var(--color-slate-950)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            </>
          ) : (
            points.map((p, i) => {
              const up = p.close >= p.open;
              const color = up ? "var(--color-emerald-400)" : "var(--color-rose-400)";
              const cx = xCandle(i);
              const width = (100 / n) * 0.6;
              const top = yOf(Math.max(p.open, p.close));
              const height = Math.max(0.6, Math.abs(yOf(p.open) - yOf(p.close)));
              return (
                <g key={p.timestamp}>
                  <line x1={cx} x2={cx} y1={yOf(p.high)} y2={yOf(p.low)} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <rect x={cx - width / 2} y={top} width={width} height={height} fill={color} />
                </g>
              );
            })
          )}
        </svg>

        {hover && hovered && (
          <>
            <div className="pointer-events-none absolute bottom-7 top-10 w-px bg-slate-500/60" style={{ left: `calc(12px + (100% - 24px) * ${hover.frac})` }} />
            <div
              className="pointer-events-none absolute top-12 z-30 min-w-36 rounded-md border border-slate-700 bg-slate-900/95 px-2.5 py-2 font-mono text-[11px] shadow-xl"
              style={hover.frac > 0.55 ? { right: "calc(100% - 12px - (100% - 24px) * " + hover.frac + " + 8px)" } : { left: `calc(12px + (100% - 24px) * ${hover.frac} + 8px)` }}
            >
              <div className="mb-1 font-bold text-slate-200">{fmtTime(hovered.timestamp)}</div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 text-slate-400">
                <span>O</span><span className="text-right text-slate-200">{hovered.open.toFixed(2)}</span>
                <span>H</span><span className="text-right text-slate-200">{hovered.high.toFixed(2)}</span>
                <span>L</span><span className="text-right text-slate-200">{hovered.low.toFixed(2)}</span>
                <span>C</span><span className="text-right text-slate-200">{hovered.close.toFixed(2)}</span>
                <span>Vol</span><span className="text-right text-slate-200">{hovered.volume.toLocaleString()}</span>
              </div>
            </div>
          </>
        )}

        <div className="pointer-events-none absolute inset-x-3 bottom-2 flex justify-between font-mono text-[10px] text-slate-600">
          <span>{firstTime}</span>
          <span>{lastTime}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-600">
        <span>{n} OHLCV samples · hover for details</span>
        <span>Range {snapshot.currency} {minimum.toFixed(2)} — {maximum.toFixed(2)}</span>
      </div>
    </div>
  );
}

// Engine flow. The first FLOW_STAGES entries exist today; the rest are planned.
const stages = [
  { label: "PRODUCER", meta: "THREAD", icon: "traders" as IconName, planned: false },
  { label: "MPSC", meta: "QUEUE", icon: "layers" as IconName, planned: false },
  { label: "MATCHER", meta: "C++", icon: "bolt" as IconName, planned: false },
  { label: "BOOK", meta: "PRICE-TIME", icon: "book" as IconName, planned: false },
  { label: "TRADE", meta: "EVENT", icon: "activity" as IconName, planned: false },
  { label: "WAL", meta: "PLANNED", icon: "database" as IconName, planned: true },
  { label: "MEMTABLE", meta: "PLANNED", icon: "layers" as IconName, planned: true },
];
const FLOW_STAGES = stages.filter((stage) => !stage.planned).length;

const sampleTraders = [
  { id: "VT-01", strategy: "Momentum", side: "BUY", count: "—", dot: "bg-cyan-400" },
  { id: "VT-02", strategy: "Mean Reversion", side: "SELL", count: "—", dot: "bg-violet-400" },
  { id: "VT-03", strategy: "Market Maker", side: "B / S", count: "—", dot: "bg-amber-400" },
  { id: "VT-04", strategy: "Random", side: "BUY", count: "—", dot: "bg-blue-400" },
  { id: "VT-05", strategy: "Momentum", side: "SELL", count: "—", dot: "bg-emerald-400" },
  { id: "VT-06", strategy: "Market Maker", side: "B / S", count: "—", dot: "bg-rose-400" },
];
const producerDots = ["bg-cyan-400", "bg-violet-400", "bg-amber-400", "bg-blue-400"];

const sampleAsks: BookLevel[] = [
  { price: 105.1, qty: 200 },
  { price: 105.15, qty: 250 },
  { price: 105.2, qty: 100 },
];
const sampleBids: BookLevel[] = [
  { price: 105.0, qty: 150 },
  { price: 104.95, qty: 80 },
  { price: 104.9, qty: 220 },
];

const workingToday = [
  "Lock-free MPSC queue",
  "Price-time order book",
  "C++ matching thread",
  "Live engine telemetry",
  "Latency histogram (p50 / p99)",
  "Start / pause / stop / reset",
  "Manual order ticket",
  "Live trade tape",
  "Real market data (Yahoo)",
  "Line + candlestick charts",
];

const roadmap = [
  "WAL + crash recovery",
  "MemTable / SSTables",
  "Bloom filters / indexes",
  "Compaction",
  "CAS contention counters",
  "Thread / CPU mapping",
  "Multi-instrument books",
  "Engine sharding",
  "Replication / failover",
  "Cross-thread order trace",
];

const LAT_BUCKETS_SHOWN = 16;

function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const [ref, shown] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} style={shown && delay ? { transitionDelay: `${delay}ms` } : undefined} className={`reveal ${shown ? "reveal-in" : ""} ${className}`}>
      {children}
    </div>
  );
}

function SectionHead({ title, text, aside }: { title: string; text: string; aside?: React.ReactNode }) {
  return (
    <Reveal className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h2>
        <p className="mt-2 max-w-xl text-sm text-slate-400">{text}</p>
      </div>
      {aside}
    </Reveal>
  );
}

const navSections = [
  { id: "overview", label: "Overview" },
  { id: "engine", label: "Engine" },
  { id: "market", label: "Market" },
  { id: "how", label: "How it works" },
];
const navIds = navSections.map((section) => section.id);

const flowSteps = [
  { title: "Producers submit orders", body: "Four threads create buy and sell orders and hand them to the queue. No thread ever waits on a lock.", planned: false },
  { title: "The MPSC queue collects them", body: "Many producers, one consumer. A lock-free queue lets every thread enqueue without blocking the others.", planned: false },
  { title: "One matcher thread decides", body: "A single thread takes orders in arrival order, so results are repeatable and the book needs no locks.", planned: false },
  { title: "The order book updates", body: "Best price first, oldest order first at the same price. Unmatched quantity rests on the book.", planned: false },
  { title: "A trade event is emitted", body: "Each match becomes a trade with a price, a quantity and both order IDs. This is what the console streams.", planned: false },
  { title: "Storage is the next milestone", body: "A write-ahead log and an LSM-tree are planned so trades survive a crash. They are not built yet.", planned: true },
];

// Pinned scroll story: the stage stays on screen while scroll progress walks through the order's journey.
function PinnedFlow() {
  const trackRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const value = span > 0 ? Math.min(1, Math.max(0, -rect.top / span)) : 0;
      setProgress(Math.round(value * 1000) / 1000);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const step = Math.min(flowSteps.length - 1, Math.floor(progress * flowSteps.length));
  const lastLit = flowSteps[step].planned ? stages.length - 1 : step;

  return (
    <section id="how" ref={trackRef} className="relative scroll-mt-16" style={{ height: `${flowSteps.length * 60 + 100}vh` }}>
      <div className="sticky top-16 flex h-[calc(100vh-4rem)] items-center">
        <div className="mx-auto grid w-full max-w-[1500px] items-center gap-8 px-4 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-8">
          <div>
            <div className="text-xs font-bold tracking-wide text-cyan-400">How it works · scroll to follow one order</div>
            <div className="relative mt-6 min-h-72">
              {flowSteps.map((item, index) => (
                <div
                  key={item.title}
                  aria-hidden={index !== step}
                  className={`absolute inset-0 transition-all duration-500 motion-reduce:transition-none ${
                    index === step ? "translate-y-0 opacity-100" : index < step ? "-translate-y-6 opacity-0" : "translate-y-6 opacity-0"
                  }`}
                >
                  <div className="font-mono text-sm text-slate-500">Step {index + 1} of {flowSteps.length}</div>
                  <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">{item.title}</h2>
                  <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-400">{item.body}</p>
                  {item.planned && <div className="mt-4"><Badge kind="planned" /></div>}
                </div>
              ))}
            </div>
            <div className="h-1 w-full max-w-xs overflow-hidden rounded bg-slate-800">
              <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-400" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="mt-2 text-[11px] text-slate-600">Illustrative walkthrough · not live data</div>
          </div>

          <ol className="relative space-y-2.5">
            <div className="absolute bottom-7 left-[27px] top-7 w-px bg-slate-800">
              <div className="w-full bg-gradient-to-b from-cyan-500 to-blue-400" style={{ height: `${progress * 100}%` }} />
            </div>
            {stages.map((stage, index) => {
              const lit = index <= lastLit;
              const current = index === (flowSteps[step].planned ? 5 : step);
              return (
                <li
                  key={stage.label}
                  className={`relative flex items-center gap-4 rounded-xl border px-3 py-2.5 transition-all duration-500 motion-reduce:transition-none ${
                    stage.planned ? "border-dashed" : ""
                  } ${
                    current
                      ? "scale-[1.02] border-cyan-400/60 bg-cyan-400/10 shadow-lg shadow-cyan-500/10"
                      : lit
                        ? "border-slate-700 bg-slate-900/70"
                        : "border-slate-800/70 bg-transparent opacity-50"
                  }`}
                >
                  <div className={`grid size-8 shrink-0 place-items-center rounded-lg ${current ? "bg-cyan-400 text-slate-950" : lit ? "bg-slate-800 text-cyan-400" : "bg-slate-900 text-slate-600"}`}>
                    <Icon name={stage.icon} />
                  </div>
                  <div>
                    <div className="text-xs font-black tracking-wide text-slate-200">{stage.label}</div>
                    <div className={`font-mono text-[11px] ${stage.planned ? "text-blue-400/80" : "text-slate-500"}`}>{stage.meta}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}


function App() {
  // ---- engine link (WebSocket bridge) ----------------------------------
  const { link, engineState, engineError, stats, trades, send } = useTelemetry();
  const live = link === "live";
  useSmoothScroll();
  const activeSection = useActiveSection(navIds);

  // ---- run controls ------------------------------------------------------
  const [simState, setSimState] = useState<RunState>("closed");
  const [speed, setSpeed] = useState<1 | 10 | 100>(10);
  const [marketSeconds, setMarketSeconds] = useState(0);
  const [activeStage, setActiveStage] = useState(-1);
  const state: RunState = live ? engineState : simState;
  const online = state === "running" || state === "paused";

  // ---- instruments + market data ----------------------------------------
  const [instrumentsOpen, setInstrumentsOpen] = useState(false);
  const [selectedSector, setSelectedSector] = useState("All sectors");
  const [query, setQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [stockSnapshot, setStockSnapshot] = useState<StockSnapshot | null>(null);
  const [stockApiState, setStockApiState] = useState<"loading" | "online" | "stale" | "error">("loading");
  const [stockApiError, setStockApiError] = useState<{ kind: StockApiError["kind"]; message: string } | null>(null);

  // ---- order ticket -------------------------------------------------------
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL">("BUY");
  const [ticketQty, setTicketQty] = useState("100");
  const [ticketPrice, setTicketPrice] = useState("150.00");
  const [ticketMsg, setTicketMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Simulated market clock: advances by `speed` market-seconds per real second.
  // It accumulates, so changing speed never makes the clock jump.
  useEffect(() => {
    if (state !== "running") return;
    const timer = window.setInterval(() => setMarketSeconds((value) => value + speed * 0.25), 250);
    return () => window.clearInterval(timer);
  }, [state, speed]);

  // Pipeline highlight animation (illustrative; cycles through the stages that exist today).
  useEffect(() => {
    if (state !== "running") return;
    const timer = window.setInterval(() => setActiveStage((value) => (value + 1) % FLOW_STAGES), Math.max(140, 1100 / speed));
    return () => window.clearInterval(timer);
  }, [state, speed]);

  // When the bridge connects, tell the engine which speed the UI is showing.
  useEffect(() => {
    if (live) send({ cmd: "speed", value: speed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // Market data: clear stale data on symbol change, keep last good data on later failures.
  useEffect(() => {
    let controller: AbortController | null = null;
    let hasData = false;
    setStockSnapshot(null);
    setStockApiState("loading");
    setStockApiError(null);

    const loadStock = async () => {
      if (document.hidden && hasData) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const snapshot = await getStockSnapshot(selectedSymbol, controller.signal);
        hasData = true;
        setStockSnapshot(snapshot);
        setStockApiState("online");
        setStockApiError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const failure = error instanceof StockApiError ? error : new StockApiError("network", "Unable to reach the stock API");
        setStockApiError({ kind: failure.kind, message: failure.message });
        if (hasData) {
          setStockApiState("stale");
        } else {
          setStockSnapshot(null);
          setStockApiState("error");
        }
      }
    };

    loadStock();
    const poller = window.setInterval(loadStock, 15_000);
    return () => {
      controller?.abort();
      window.clearInterval(poller);
    };
  }, [selectedSymbol]);

  const control = (cmd: "start" | "pause" | "stop" | "reset") => {
    if (live) {
      send({ cmd });
    } else {
      setSimState(cmd === "start" ? "running" : cmd === "pause" ? "paused" : cmd === "stop" ? "stopped" : "closed");
    }
    if (cmd === "reset") {
      setMarketSeconds(0);
      setActiveStage(-1);
    }
  };

  const changeSpeed = (value: 1 | 10 | 100) => {
    setSpeed(value);
    if (live) send({ cmd: "speed", value });
  };

  const submitOrder = () => {
    const qty = Number(ticketQty);
    const price = Number(ticketPrice);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) {
      setTicketMsg({ ok: false, text: "Quantity must be a whole number between 1 and 100,000." });
      return;
    }
    if (!Number.isFinite(price) || price < 0.01 || price > 100000) {
      setTicketMsg({ ok: false, text: "Price must be between 0.01 and 100,000." });
      return;
    }
    const sent = send({ cmd: "order", side: ticketSide, qty, price: Math.round(price * 100) / 100 });
    setTicketMsg(
      sent
        ? { ok: true, text: `Sent ${ticketSide} ${qty} @ ${price.toFixed(2)} to the engine queue.` }
        : { ok: false, text: "Not connected to the engine bridge." },
    );
  };

  const marketTime = useMemo(() => {
    const total = 9 * 3600 + 30 * 60 + Math.floor(marketSeconds);
    const hours = Math.floor(total / 3600) % 24;
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return [hours, minutes, secs].map((part) => part.toString().padStart(2, "0")).join(":");
  }, [marketSeconds]);
  const today = useMemo(() => new Date().toLocaleDateString("en-CA"), []);

  const sectors = useMemo(
    () => ["All sectors", ...Array.from(new Set(sp500.map((stock) => stock.sector))).sort()],
    [],
  );
  const visibleStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sp500.filter(
      (stock) =>
        (selectedSector === "All sectors" || stock.sector === selectedSector) &&
        (q === "" || stock.symbol.toLowerCase().includes(q) || stock.name.toLowerCase().includes(q)),
    );
  }, [selectedSector, query]);

  // ---- derived engine view ------------------------------------------------
  const hasLiveData = live && stats !== null;
  const lastTrade = trades[0];
  const asks = hasLiveData ? stats.asks : sampleAsks;
  const bids = hasLiveData ? stats.bids : sampleBids;
  const maxQty = Math.max(1, ...asks.map((l) => l.qty), ...bids.map((l) => l.qty));
  const bestAsk = asks[0]?.price;
  const bestBid = bids[0]?.price;
  const spread = bestAsk !== undefined && bestBid !== undefined ? bestAsk - bestBid : null;
  const dash = "—";
  const histogram = hasLiveData ? stats.latHist : [];
  const histShown = histogram.slice(0, LAT_BUCKETS_SHOWN - 1).concat(histogram.slice(LAT_BUCKETS_SHOWN - 1).reduce((a, b) => a + b, 0));
  const histMax = Math.max(1, ...histShown);
  const histTotal = histShown.reduce((a, b) => a + b, 0);

  const linkLabel =
    link === "live"
      ? `Connected · ${TELEMETRY_URL} · engine ${engineState}`
      : link === "connecting"
        ? `Connecting to ${TELEMETRY_URL}…`
        : `Bridge offline · UI is in simulation mode · run telemetry-bridge/bridge.py (${TELEMETRY_URL})`;

  const metrics: [string, string, IconName][] = [
    ["ORDERS / SEC", hasLiveData ? fmtInt(stats.ordersPerSec) : dash, "activity"],
    ["TRADES / SEC", hasLiveData ? fmtInt(stats.tradesPerSec) : dash, "bolt"],
    ["AVG LATENCY", hasLiveData ? fmtUs(stats.avgLatencyUs) : dash, "clock"],
    ["P99 LATENCY", hasLiveData ? `≤ ${fmtUs(stats.p99LatencyUs)}` : dash, "clock"],
    ["QUEUE DEPTH", hasLiveData ? fmtInt(stats.queueDepth) : dash, "layers"],
    ["CPU", hasLiveData ? `${stats.cpuPct.toFixed(0)}%` : dash, "cpu"],
    ["MEMORY", hasLiveData && stats.rssMb > 0 ? `${stats.rssMb.toFixed(1)} MB` : dash, "server"],
    ["THREADS", hasLiveData ? String(stats.threads) : dash, "cpu"],
  ];

  const producerRows = hasLiveData
    ? stats.producers.map((count, index) => ({
        id: `P-${String(index + 1).padStart(2, "0")}`,
        strategy: "Random order generator",
        side: "B / S",
        count: fmtInt(count),
        dot: producerDots[index % producerDots.length],
      }))
    : sampleTraders;

  return (
    <main className="relative isolate min-h-screen bg-slate-950 text-slate-300 selection:bg-cyan-400/30">
      <div className="scroll-progress" aria-hidden="true" />
      <div className="bg-blob blob-a" aria-hidden="true" />
      <div className="bg-blob blob-b" aria-hidden="true" />

      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-8">
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex items-center gap-2.5 text-left" aria-label="Back to top">
            <div className="relative grid size-9 place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-cyan-400 to-blue-400 text-slate-950">
              <Icon name="activity" size="lg" />
            </div>
            <div>
              <div className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-base font-black leading-none tracking-tight text-transparent">TICKFORGE</div>
              <div className="mt-1 text-[10px] font-semibold tracking-wide text-slate-500">Exchange systems console</div>
            </div>
          </button>

          <nav aria-label="Sections" className="ml-2 hidden items-center gap-1 lg:flex">
            {navSections.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={activeSection === item.id ? "true" : undefined}
                onClick={() => scrollToSection(item.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${activeSection === item.id ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-300"}`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div title={linkLabel} className={`flex max-w-64 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs font-semibold ${link === "live" ? "text-emerald-400" : link === "connecting" ? "text-amber-400" : "text-slate-400"}`}>
              <span className={`size-2 shrink-0 rounded-full ${link === "live" ? "bg-emerald-400" : link === "connecting" ? "animate-pulse bg-amber-400" : "bg-rose-400"}`} />
              <span className="truncate">{link === "live" ? "Engine bridge live" : link === "connecting" ? "Connecting…" : "Bridge offline · simulation"}</span>
              {engineError && <span className="truncate text-rose-400">· {engineError}</span>}
            </div>
            <div className={`hidden items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold sm:flex ${online ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-slate-700 bg-slate-800 text-slate-400"}`}>
              <span className={`size-2 rounded-full ${state === "running" ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
              MARKET {state === "running" ? "OPEN" : state === "paused" ? "PAUSED" : "CLOSED"}
            </div>
            <Action label="Start" icon="play" active={state === "running"} onClick={() => control("start")} />
            <Action label="Pause" icon="pause" disabled={state !== "running"} onClick={() => control("pause")} />
            <Action label="Stop" icon="stop" disabled={!online} onClick={() => control("stop")} />
            <Action label="Reset" icon="reset" onClick={() => control("reset")} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 lg:px-8">
        <section id="overview" className="scroll-mt-24 pb-16 pt-10">
          <SectionHead
            title="Overview"
            text="A live look at the exchange engine. Start it to stream real orders, or use simulation mode while the bridge is offline."
            aside={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 font-mono" title="Simulated market clock">
                  <span className="text-[10px] font-bold tracking-wider text-slate-600">SIM</span>
                  <span className="text-xs text-slate-500">{today}</span>
                  <span className="text-sm font-bold tabular-nums text-white">{marketTime}</span>
                </div>
                <div className="flex rounded-lg border border-slate-800 bg-slate-950/70 p-1" role="group" aria-label="Simulation speed">
                  {([1, 10, 100] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={speed === value}
                      onClick={() => changeSpeed(value)}
                      className={`cursor-pointer rounded px-2.5 py-1.5 text-xs font-bold transition ${speed === value ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      {value}x
                    </button>
                  ))}
                </div>
              </div>}
          />
          <div className="grid grid-cols-12 items-start gap-5">
            <Reveal className="col-span-12">
              <section className="col-span-12 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-800 md:grid-cols-4 xl:grid-cols-8 xl:divide-y-0">
              {metrics.map(([label, value, icon]) => (
                <div key={label} className="group px-4 py-3 transition hover:bg-slate-800/40">
                  <div className="mb-2 flex items-center justify-between text-slate-600 group-hover:text-cyan-400">
                    <Icon name={icon} size="sm" />
                    <span className={`size-1.5 rounded-full ${hasLiveData ? "bg-emerald-400" : "bg-slate-700"}`} />
                  </div>
                  <div className="font-mono text-lg font-black text-slate-300">{value}</div>
                  <div className="text-[10px] font-bold tracking-wider text-slate-600">{label}</div>
                </div>
              ))}
            </div>
          </section>
            </Reveal>
            <Panel
            title="Live Order Trace"
            eyebrow="End-to-end event pipeline"
            icon="activity"
            className="col-span-12 xl:col-span-8"
            action={<div className="flex items-center gap-2"><Badge kind="simulated" label="ILLUSTRATIVE ANIMATION" /><div className="flex items-center gap-2 rounded-md bg-slate-950 px-2.5 py-1.5 font-mono text-[11px] text-slate-500"><span className="size-1.5 rounded-full bg-cyan-400" /> TRACE MODE</div></div>}
          >
            <div className="p-4">
              <div className="mb-4 flex items-center justify-between rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="rounded bg-cyan-400/10 px-2 py-1 font-mono text-xs font-black text-cyan-400">{lastTrade ? `TRADE #${lastTrade.id}` : "NO TRADE YET"}</div>
                  <div className="font-mono text-xs text-slate-400">
                    {lastTrade ? (
                      <>
                        <span className="font-bold text-emerald-400">{lastTrade.qty}</span> @ ${lastTrade.price.toFixed(2)} · buy order {lastTrade.buy} × sell order {lastTrade.sell}
                      </>
                    ) : live ? (
                      "Start the engine to see matched trades"
                    ) : (
                      "Engine bridge offline — pipeline below is an animation only"
                    )}
                  </div>
                </div>
                <div className="hidden font-mono text-[11px] text-slate-600 sm:block">{live ? "Live engine event" : "Waiting for telemetry"}</div>
              </div>

              <div className="relative overflow-x-auto pb-2">
                <div className="absolute left-8 right-8 top-7 h-px bg-slate-700" />
                <div className={`absolute left-8 top-7 h-px bg-cyan-400 transition-all duration-500 ${activeStage < 0 ? "w-0" : ""}`} style={activeStage >= 0 ? { width: `${(activeStage / (stages.length - 1)) * 90}%` } : undefined} />
                <div className="relative grid min-w-[760px] grid-cols-7 gap-2">
                  {stages.map((stage, index) => {
                    const active = index === activeStage;
                    const complete = activeStage >= 0 && index < activeStage;
                    return (
                      <div key={stage.label} className="flex flex-col items-center text-center">
                        <div className={`grid size-14 place-items-center rounded-xl border-2 transition-all duration-300 ${stage.planned ? "border-dashed border-slate-700 bg-slate-900/40 text-slate-600" : active ? "scale-110 border-cyan-400 bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/30" : complete ? "border-cyan-500/50 bg-slate-900 text-cyan-400" : "border-slate-700 bg-slate-900 text-slate-500"}`}>
                          <Icon name={stage.icon} size="lg" />
                        </div>
                        <div className={`mt-2 text-[10px] font-black tracking-wide ${active ? "text-cyan-400" : stage.planned ? "text-slate-600" : "text-slate-400"}`}>{stage.label}</div>
                        <div className={`mt-0.5 font-mono text-[10px] ${stage.planned ? "text-blue-400/70" : "text-slate-600"}`}>{stage.meta}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 border-t border-slate-800 bg-slate-950/50 md:grid-cols-4">
              {[
                ["LAST TRADE ID", lastTrade ? String(lastTrade.id) : "Not assigned"],
                ["CURRENT STAGE", activeStage >= 0 ? stages[activeStage].label : "Idle"],
                ["AVG QUEUE→MATCH", hasLiveData ? fmtUs(stats.avgLatencyUs) : "— μs"],
                ["RESULT", lastTrade ? `${lastTrade.qty} @ ${lastTrade.price.toFixed(2)}` : "Awaiting event"],
              ].map(([label, value]) => (
                <div key={label} className="border-r border-slate-800 px-4 py-3 last:border-r-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</div>
                  <div className="mt-1 font-mono text-[12px] font-semibold text-slate-300">{value}</div>
                </div>
              ))}
            </div>
          </Panel>
            <Panel
            title={hasLiveData ? "Order Producers" : "Virtual Traders"}
            eyebrow={hasLiveData ? `Engine workload · ${producerRows.length} producer threads` : `Sample workload generators · ${producerRows.length}`}
            icon="traders"
            className="col-span-12 xl:col-span-4"
            action={<Badge kind={hasLiveData ? "live" : "sample"} />}
          >
            <div className="grid grid-cols-[1fr_auto_auto] border-b border-slate-800 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              <span>{hasLiveData ? "Producer" : "Trader"} / Strategy</span><span>Intent</span><span className="ml-5">{hasLiveData ? "Orders" : "Position"}</span>
            </div>
            <div className="divide-y divide-slate-800/80">
              {producerRows.map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_auto_auto] items-center px-4 py-2.5 transition hover:bg-slate-800/40">
                  <div className="flex items-center gap-2.5">
                    <span className={`size-1.5 rounded-full ${state === "running" && hasLiveData ? `${row.dot} animate-pulse` : "bg-slate-600"}`} />
                    <div>
                      <div className="font-mono text-[12px] font-bold text-slate-200">{row.id}</div>
                      <div className="text-[11px] text-slate-500">{row.strategy}</div>
                    </div>
                  </div>
                  <span className={`rounded border px-1.5 py-1 font-mono text-[10px] font-bold ${row.side === "BUY" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : row.side === "SELL" ? "border-rose-500/20 bg-rose-500/10 text-rose-400" : "border-slate-700 bg-slate-800 text-slate-400"}`}>{row.side}</span>
                  <span className="ml-5 font-mono text-[12px] text-slate-400">{row.count}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 border-t border-slate-800 bg-slate-950/40">
              {[
                ["ORDERS", hasLiveData ? fmtInt(stats.submitted) : dash],
                ["TRADES", hasLiveData ? fmtInt(stats.tradesTotal) : dash],
                ["IN QUEUE", hasLiveData ? fmtInt(stats.queueDepth) : dash],
              ].map(([label, value]) => (
                <div key={label} className="border-r border-slate-800 px-3 py-2.5 text-center last:border-r-0">
                  <div className="font-mono text-sm font-bold text-slate-300">{value}</div>
                  <div className="text-[10px] font-bold tracking-wider text-slate-600">{label}</div>
                </div>
              ))}
            </div>
          </Panel>
          </div>
        </section>

        <section id="engine" className="scroll-mt-24 pb-16">
          <SectionHead title="Engine" text="The order book, the trades it produces, and how long each order waited in the queue." />
          <div className="grid grid-cols-12 items-start gap-5">
            <Panel
            title="Matching Engine"
            eyebrow="Price-time priority · SYM-1 (synthetic)"
            icon="book"
            className="col-span-12 xl:col-span-7"
            action={<Badge kind={hasLiveData ? "live" : "sample"} />}
          >
            <div className="grid grid-cols-[1fr_auto_1fr]">
              <div className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                  <span className="text-rose-400">Sell / Ask</span><span className="text-slate-600">Qty</span>
                </div>
                <div className="space-y-1">
                  {asks.length === 0 && <div className="py-2 font-mono text-[11px] text-slate-600">No resting asks</div>}
                  {asks.map((level) => (
                    <div key={level.price} className="relative flex items-center justify-between overflow-hidden rounded px-2 py-1.5 font-mono text-[12px]">
                      <div className="absolute inset-y-0 right-0 bg-rose-500/10" style={{ width: `${(level.qty / maxQty) * 100}%` }} />
                      <span className="relative font-semibold text-rose-400">${level.price.toFixed(2)}</span><span className="relative text-slate-400">{fmtInt(level.qty)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="w-px bg-slate-800" />
              <div className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                  <span className="text-emerald-400">Buy / Bid</span><span className="text-slate-600">Qty</span>
                </div>
                <div className="space-y-1">
                  {bids.length === 0 && <div className="py-2 font-mono text-[11px] text-slate-600">No resting bids</div>}
                  {bids.map((level) => (
                    <div key={level.price} className="relative flex items-center justify-between overflow-hidden rounded px-2 py-1.5 font-mono text-[12px]">
                      <div className="absolute inset-y-0 left-0 bg-emerald-500/10" style={{ width: `${(level.qty / maxQty) * 100}%` }} />
                      <span className="relative font-semibold text-emerald-400">${level.price.toFixed(2)}</span><span className="relative text-slate-400">{fmtInt(level.qty)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/50 px-4 py-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Spread</div>
                <div className="font-mono text-xs font-bold text-amber-400">{spread !== null ? `$${spread.toFixed(2)}` : dash}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Last trade</div>
                <div className="font-mono text-xs font-bold text-slate-300">{lastTrade ? `$${lastTrade.price.toFixed(2)}` : "No trades"}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Matched</div>
                <div className="font-mono text-xs font-bold text-slate-300">{hasLiveData ? fmtInt(stats.tradesTotal) : dash}</div>
              </div>
            </div>

            <div className="border-t border-slate-800 px-4 py-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">Trade tape</div>
              {trades.length === 0 ? (
                <div className="font-mono text-[11px] text-slate-600">{live ? "No trades yet" : "Connect the bridge and start the engine"}</div>
              ) : (
                <div className="max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11px]">
                  {trades.slice(0, 8).map((trade) => (
                    <div key={trade.id} className="flex justify-between text-slate-400">
                      <span className="text-slate-600">#{trade.id}</span>
                      <span className="font-semibold text-slate-200">${trade.price.toFixed(2)}</span>
                      <span>{trade.qty}</span>
                      <span className="text-slate-600">b{trade.buy} / s{trade.sell}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-800 px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Order ticket</div>
                {!(live && state === "running") && <span className="text-[10px] text-slate-600">Start the engine (live link) to place orders</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-md border border-slate-800 bg-slate-950 p-0.5" role="group" aria-label="Order side">
                  {(["BUY", "SELL"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      aria-pressed={ticketSide === side}
                      onClick={() => setTicketSide(side)}
                      className={`rounded px-3 py-1.5 text-[11px] font-bold transition ${ticketSide === side ? (side === "BUY" ? "bg-emerald-400 text-slate-950" : "bg-rose-400 text-slate-950") : "text-slate-500 hover:text-slate-300"}`}
                    >
                      {side}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  Qty
                  <input value={ticketQty} onChange={(event) => setTicketQty(event.target.value)} inputMode="numeric" className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[12px] text-slate-200 outline-none focus:border-cyan-400" />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  Price
                  <input value={ticketPrice} onChange={(event) => setTicketPrice(event.target.value)} inputMode="decimal" className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[12px] text-slate-200 outline-none focus:border-cyan-400" />
                </label>
                <button
                  type="button"
                  disabled={!(live && state === "running")}
                  onClick={submitOrder}
                  className="rounded-md border border-cyan-400 bg-cyan-400 px-3 py-1.5 text-[11px] font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
                >
                  Submit order
                </button>
              </div>
              {ticketMsg && <div className={`mt-2 text-[11px] ${ticketMsg.ok ? "text-emerald-400" : "text-rose-400"}`} role="status">{ticketMsg.text}</div>}
            </div>
          </Panel>
            <Panel
            title="Latency Histogram"
            eyebrow="Queue → match, since engine start"
            icon="clock"
            className="col-span-12 xl:col-span-5"
            action={<Badge kind={hasLiveData ? "live" : "sample"} label={hasLiveData ? "LIVE" : "NO DATA"} />}
          >
            {hasLiveData && histTotal > 0 ? (
              <div className="p-4">
                <div className="flex h-36 items-end gap-1 rounded-lg border border-slate-800 bg-slate-950/60 px-2 pb-2 pt-3">
                  {histShown.map((count, index) => (
                    <div key={index} className="flex h-full flex-1 flex-col justify-end" title={`${index === LAT_BUCKETS_SHOWN - 1 ? "≥" : "<"} ${fmtUs(2 ** (index === LAT_BUCKETS_SHOWN - 1 ? index - 1 : index))}: ${count.toLocaleString()} orders`}>
                      <div className="w-full rounded-t bg-cyan-400/80" style={{ height: `${Math.max(count > 0 ? 3 : 0, (count / histMax) * 100)}%` }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-1 px-2 font-mono text-[9px] text-slate-600">
                  {histShown.map((_, index) => (
                    <div key={index} className="flex-1 text-center">{index % 4 === 0 ? fmtUs(2 ** index).replace(" ", "") : ""}</div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {[["P50", `≤ ${fmtUs(stats.p50LatencyUs)}`], ["P99", `≤ ${fmtUs(stats.p99LatencyUs)}`], ["AVG", fmtUs(stats.avgLatencyUs)], ["SAMPLES", fmtInt(histTotal)]].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-slate-800 bg-slate-950/50 px-2 py-2">
                      <div className="font-mono text-[12px] font-bold text-slate-200">{value}</div>
                      <div className="text-[10px] font-bold tracking-wider text-slate-600">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[10px] text-slate-600">Percentiles are bucket upper bounds (power-of-two µs buckets). Includes time spent waiting in the queue.</div>
              </div>
            ) : (
              <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center text-[11px] text-slate-500">
                <div className="mb-2 text-xs font-bold text-slate-400">No latency samples yet</div>
                {live ? "Press Start to run the engine and collect samples." : "Connect the telemetry bridge, then start the engine."}
              </div>
            )}
          </Panel>
          </div>
        </section>

        <section id="market" className="scroll-mt-24 pb-16">
          <SectionHead title="Market data" text="Real intraday prices for any S&P 500 stock, served by the Python API." />
          <div className="grid grid-cols-12 items-start gap-5">
            <Panel
            title={`${selectedSymbol} Market Data`}
            eyebrow="Python stock API · 1 day / 5 minute interval"
            icon="activity"
            className="col-span-12 xl:col-span-8"
            action={
              <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider ${
                stockApiState === "online"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                  : stockApiState === "loading" || stockApiState === "stale"
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                    : "border-rose-500/20 bg-rose-500/10 text-rose-400"
              }`}>
                <span className={`size-1.5 rounded-full ${stockApiState === "online" ? "animate-pulse bg-emerald-400" : stockApiState === "loading" || stockApiState === "stale" ? "animate-pulse bg-amber-400" : "bg-rose-400"}`} />
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
                    <div className="mt-1 text-[11px] text-slate-500">Last update {new Date(stockSnapshot.updatedAt).toLocaleString()}</div>
                    {stockApiState === "stale" && stockApiError && (
                      <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-400" role="status">
                        Showing last good data — latest refresh failed: {stockApiError.message}
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    {[
                      ["Previous close", `${stockSnapshot.currency} ${stockSnapshot.previousClose.toFixed(2)}`],
                      ["Volume", stockSnapshot.volume.toLocaleString()],
                      ["Market state", stockSnapshot.marketState],
                      ["Data points", String(stockSnapshot.history.length)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between border-b border-slate-800 pb-2 text-[11px] last:border-0">
                        <span className="text-slate-500">{label}</span>
                        <span className="font-mono font-bold text-slate-300">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-900 p-4">
                  <PriceChart key={stockSnapshot.symbol} snapshot={stockSnapshot} />
                </div>
              </div>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
                <div className={`mb-4 grid size-12 place-items-center rounded-xl border ${stockApiState === "loading" ? "animate-pulse border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400"}`}>
                  <Icon name={stockApiState === "loading" ? "clock" : "server"} size="lg" />
                </div>
                <div className="text-xs font-bold text-slate-300">
                  {stockApiState === "loading"
                    ? `Loading ${selectedSymbol} market data`
                    : stockApiError?.kind === "network"
                      ? "Python stock API unavailable"
                      : `Couldn't load ${selectedSymbol}`}
                </div>
                <div className="mt-2 max-w-xl text-[11px] leading-relaxed text-slate-500">
                  {stockApiState === "loading"
                    ? "Waiting for a valid quote and OHLCV history response."
                    : stockApiError?.kind === "network"
                      ? "Start the Python service (uvicorn main:app in market-data/) or set VITE_STOCK_API_URL in your .env file."
                      : stockApiError?.message}
                </div>
                <div className="mt-4 rounded-md bg-slate-950 px-3 py-2 font-mono text-[10px] text-slate-600">GET /api/stocks/{selectedSymbol}?range=1d&amp;interval=5m</div>
              </div>
            )}
          </Panel>
            <Panel
            title="S&P 500 Universe"
            eyebrow={`${sp500.length} current constituents · ${sectors.length - 1} sectors`}
            icon="book"
            className="col-span-12 xl:col-span-4"
            action={
              <button
                type="button"
                aria-expanded={instrumentsOpen}
                onClick={() => setInstrumentsOpen((value) => !value)}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition hover:border-slate-500"
              >
                {instrumentsOpen ? "Collapse list" : "Browse all stocks"}
                <span className={`transition-transform ${instrumentsOpen ? "rotate-90" : ""}`}><Icon name="chevron" size="sm" /></span>
              </button>
            }
          >
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/40 px-4 py-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Active instrument</div>
                <div className="mt-0.5 font-mono text-lg font-black text-cyan-400">{selectedSymbol}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Universe source</div>
                <div className="mt-1 text-[11px] text-slate-400">S&P 500 constituents dataset</div>
              </div>
            </div>
            {instrumentsOpen ? (
              <>
                <div className="border-b border-slate-800 px-4 py-3">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search symbol or company…"
                    aria-label="Search instruments"
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[12px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-400"
                  />
                </div>
                <div className="flex gap-1.5 overflow-x-auto border-b border-slate-800 px-4 py-3">
                  {sectors.map((sector) => (
                    <button
                      key={sector}
                      type="button"
                      aria-pressed={selectedSector === sector}
                      onClick={() => setSelectedSector(sector)}
                      className={`shrink-0 cursor-pointer rounded-md border px-2 py-1.5 text-[10px] font-bold transition ${
                        selectedSector === sector
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-400"
                          : "border-slate-800 bg-slate-950 text-slate-500 hover:border-slate-600"
                      }`}
                    >
                      {sector}
                    </button>
                  ))}
                </div>
                <div className="grid max-h-80 grid-cols-1 overflow-y-auto sm:grid-cols-2">
                  {visibleStocks.length === 0 && <div className="col-span-full px-4 py-6 text-center text-[11px] text-slate-600">No instruments match your search.</div>}
                  {visibleStocks.map((stock) => (
                    <button
                      key={stock.symbol}
                      type="button"
                      aria-pressed={selectedSymbol === stock.symbol}
                      onClick={() => setSelectedSymbol(stock.symbol)}
                      className={`flex cursor-pointer items-center justify-between border-b border-slate-800/70 px-4 py-2.5 text-left transition sm:odd:border-r ${
                        selectedSymbol === stock.symbol ? "bg-cyan-400/10" : "hover:bg-slate-800/40"
                      }`}
                    >
                      <div className="min-w-0 pr-3">
                        <div className={`font-mono text-[12px] font-black ${selectedSymbol === stock.symbol ? "text-cyan-400" : "text-slate-300"}`}>{stock.symbol}</div>
                        <div className="truncate text-[10px] text-slate-500">{stock.name}</div>
                      </div>
                      <div className="max-w-24 truncate rounded bg-slate-800 px-1.5 py-1 text-[9px] font-bold text-slate-500">{stock.sector}</div>
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-800 px-4 py-2 text-[10px] text-slate-600">
                  Showing {visibleStocks.length} instruments · Select a symbol to load its market data
                </div>
              </>
            ) : (
              <div className="grid grid-cols-3 gap-px bg-slate-800">
                {[
                  ["CONSTITUENTS", String(sp500.length)],
                  ["SECTORS", String(sectors.length - 1)],
                  ["SELECTION", selectedSymbol],
                ].map(([label, value]) => (
                  <div key={label} className="bg-slate-900 px-4 py-4 text-center">
                    <div className="font-mono text-lg font-black text-slate-300">{value}</div>
                    <div className="mt-1 text-[10px] font-bold tracking-wider text-slate-600">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          </div>
        </section>
      </div>

      <PinnedFlow />

      <div className="mx-auto max-w-[1500px] px-4 pb-6 pt-10 lg:px-8">
        <div className="grid grid-cols-12 gap-5">
          <Panel
            title="Project status"
            eyebrow="What exists today, and what is still planned"
            icon="layers"
            className="col-span-12"
          >
            <div className="grid gap-px bg-slate-800 md:grid-cols-2">
              <div className="bg-slate-900 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[11px] font-black uppercase tracking-wider text-emerald-400">Working today</div>
                  <div className="rounded bg-emerald-500/10 px-2 py-1 font-mono text-[10px] font-bold text-emerald-400">{workingToday.length} capabilities</div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {workingToday.map((capability) => (
                    <div key={capability} className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-[10px] font-black text-emerald-400">✓</span>
                      <span>{capability}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-slate-900 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[11px] font-black uppercase tracking-wider text-blue-400">Roadmap</div>
                  <div className="rounded bg-blue-500/10 px-2 py-1 font-mono text-[10px] font-bold text-blue-400">{roadmap.length} planned</div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {roadmap.map((capability) => (
                    <div key={capability} className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span className="size-2 shrink-0 rounded-full bg-blue-400 shadow-sm shadow-blue-400" />
                      <span>{capability}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </div>

        <footer className="flex flex-col gap-2 px-1 py-6 text-[10px] font-medium uppercase tracking-wider text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>TickForge observability console · Controller isolated from matching path</span>
          <span className="flex items-center gap-2">
            <span className={`size-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-amber-400"}`} />
            {live ? `Engine ${state} · live metrics` : "Bridge offline · engine panels show sample data"}
          </span>
        </footer>
      </div>
    </main>
  );
}

export default App;
