import { memo, useEffect, useMemo, useRef, useState } from "react";
import { getJourney, StockApiError, type JourneyData, type JourneyEvent, type JourneyRange } from "./stockApi";

const RANGES: { id: JourneyRange; label: string }[] = [
  { id: "1d", label: "1D" },
  { id: "5d", label: "5D" },
  { id: "1mo", label: "1M" },
  { id: "6mo", label: "6M" },
  { id: "1y", label: "1Y" },
];

const KIND_STYLE: Record<JourneyEvent["kind"], { dot: string; tag: string; name: string }> = {
  open: { dot: "bg-slate-400", tag: "text-slate-400", name: "OPEN" },
  rise: { dot: "bg-emerald-400", tag: "text-emerald-400", name: "RISE" },
  fall: { dot: "bg-rose-400", tag: "text-rose-400", name: "FALL" },
  high: { dot: "bg-emerald-400", tag: "text-emerald-400", name: "HIGH" },
  low: { dot: "bg-rose-400", tag: "text-rose-400", name: "LOW" },
  volume: { dot: "bg-blue-400", tag: "text-blue-400", name: "VOLUME" },
  close: { dot: "bg-cyan-400", tag: "text-cyan-400", name: "CLOSE" },
};

// Attributes that need a trade ledger. Yahoo does not say who bought or sold, so these stay empty on purpose.
const LEDGER_FIELDS = ["Bought", "Sold", "Net position", "Avg buy price", "Avg sell price", "Realized P&L", "Unrealized P&L", "Win rate", "Best trade", "Worst trade"];

// Same format as the story sentences written by the API: "$1,234.50" for USD, "1,234.50 INR" otherwise.
const money = (value: number, currency: string) => {
  const text = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${text}` : `${text} ${currency}`;
};
const pct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const tone = (value: number) => (value >= 0 ? "text-emerald-400" : "text-rose-400");
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const DASH = "—";

type Focus = { from: string; to: string } | null;

function Tile({ label, value, sub, valueClass = "text-white" }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-slate-900 px-4 py-3.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1.5 font-mono text-lg font-black leading-tight ${valueClass}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] leading-snug text-slate-500">{sub}</div>}
    </div>
  );
}

function JourneyChart({ data, focus }: { data: JourneyData; focus: Focus }) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const bars = data.history;
  const n = bars.length;
  const indexOf = useMemo(() => new Map(bars.map((bar, i) => [bar.timestamp, i])), [bars]);
  const low = Math.min(...bars.map((b) => b.low));
  const high = Math.max(...bars.map((b) => b.high));
  const span = high - low || 1;
  const maxVolume = Math.max(1, ...bars.map((b) => b.volume));
  const spikeTimes = useMemo(() => new Set(data.volume.spikes.map((s) => s.time)), [data.volume.spikes]);

  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (price: number) => 72 - ((price - low) / span) * 66; // price zone: 6..72, volume zone: 82..100
  const linePoints = bars.map((b, i) => `${x(i)},${y(b.close)}`).join(" ");
  const up = data.close >= data.open;
  const accent = up ? "var(--color-emerald-400)" : "var(--color-rose-400)";

  const band = (from: string, to: string) => {
    const a = indexOf.get(from);
    const b = indexOf.get(to);
    if (a === undefined || b === undefined) return null;
    const left = x(Math.min(a, b));
    return { left, width: Math.max(Math.abs(x(b) - x(a)), 0.8) };
  };
  const drawdownBand = data.maxDrawdown ? band(data.maxDrawdown.start.time, data.maxDrawdown.end.time) : null;
  const runUpBand = data.maxRunUp ? band(data.maxRunUp.start.time, data.maxRunUp.end.time) : null;
  const focusBand = focus ? band(focus.from, focus.to) : null;

  const highIndex = indexOf.get(data.high.time);
  const lowIndex = indexOf.get(data.low.time);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const inner = rect.width - 24; // plot area is inset 12px each side
    if (inner <= 0) return;
    const frac = Math.min(1, Math.max(0, (event.clientX - rect.left - 12) / inner));
    setHover(n === 1 ? 0 : Math.round(frac * (n - 1)));
  };

  const hovered = hover !== null ? bars[hover] : null;
  const hoverFrac = hover !== null ? x(hover) / 100 : 0;
  const summary = `${data.symbol} ${data.range} journey: opened at ${money(data.open, data.currency)}, closed at ${money(data.close, data.currency)}, high ${money(data.high.price, data.currency)} at ${data.high.label}, low ${money(data.low.price, data.currency)} at ${data.low.label}.`;

  return (
    <div>
      <div
        ref={boxRef}
        role="img"
        aria-label={summary}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        className="relative h-80 touch-pan-y overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60"
      >
        <div className="absolute inset-x-3 bottom-7 top-10">
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={`journey-fill-${data.symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity="0.22" />
                <stop offset="100%" stopColor={accent} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[6, 28, 50, 72].map((line) => (
              <line key={line} x1="0" x2="100" y1={line} y2={line} stroke="var(--color-slate-800)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {runUpBand && <rect data-testid="runup-band" x={runUpBand.left} y="2" width={runUpBand.width} height="72" fill="var(--color-emerald-400)" opacity="0.1" />}
            {drawdownBand && <rect data-testid="drawdown-band" x={drawdownBand.left} y="2" width={drawdownBand.width} height="72" fill="var(--color-rose-400)" opacity="0.13" />}
            {n > 1 && <polygon points={`0,76 ${linePoints} 100,76`} fill={`url(#journey-fill-${data.symbol})`} />}
            <polyline points={linePoints} fill="none" stroke={accent} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            {bars.map((b, i) => (
              <rect
                key={b.timestamp}
                data-testid={spikeTimes.has(b.timestamp) ? "volume-spike" : undefined}
                x={x(i) - Math.max((100 / n) * 0.35, 0.15)}
                y={100 - (b.volume / maxVolume) * 18}
                width={Math.max((100 / n) * 0.7, 0.3)}
                height={(b.volume / maxVolume) * 18}
                fill={spikeTimes.has(b.timestamp) ? "var(--color-blue-400)" : "var(--color-cyan-500)"}
                opacity={spikeTimes.has(b.timestamp) ? 0.9 : 0.35}
              />
            ))}
            {focusBand && <rect data-testid="focus-band" x={focusBand.left} y="0" width={focusBand.width} height="100" fill="var(--color-cyan-400)" opacity="0.22" />}
          </svg>

          {highIndex !== undefined && (
            <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full" style={{ left: `${x(highIndex)}%`, top: `${y(data.high.price)}%` }}>
              <span data-testid="marker-high" className="whitespace-nowrap rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400">High {data.high.price.toFixed(2)}</span>
            </div>
          )}
          {lowIndex !== undefined && (
            <div className="pointer-events-none absolute z-10 -translate-x-1/2" style={{ left: `${x(lowIndex)}%`, top: `${y(data.low.price)}%` }}>
              <span data-testid="marker-low" className="whitespace-nowrap rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-400">Low {data.low.price.toFixed(2)}</span>
            </div>
          )}
          {[{ i: 0, price: bars[0].open }, { i: n - 1, price: bars[n - 1].close }].map((dot) => (
            <div key={dot.i} className="pointer-events-none absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950" style={{ left: `${x(dot.i)}%`, top: `${y(dot.price)}%`, background: accent }} />
          ))}
        </div>

        {hovered && (
          <>
            <div className="pointer-events-none absolute bottom-7 top-10 z-20 w-px bg-slate-500/60" style={{ left: `calc(12px + (100% - 24px) * ${hoverFrac})` }} />
            <div
              className="pointer-events-none absolute top-12 z-30 min-w-40 rounded-md border border-slate-700 bg-slate-900/95 px-2.5 py-2 font-mono text-[11px] shadow-xl"
              style={hoverFrac > 0.55 ? { right: `calc(100% - 12px - (100% - 24px) * ${hoverFrac} + 8px)` } : { left: `calc(12px + (100% - 24px) * ${hoverFrac} + 8px)` }}
            >
              <div className="mb-1 font-bold text-slate-200">{hovered.label}</div>
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
          <span>{data.periodStart.label}</span>
          <span>{data.periodEnd.label}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-3 rounded-sm bg-rose-400/30" /> Biggest fall</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-3 rounded-sm bg-emerald-400/25" /> Biggest rise</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-3 rounded-sm bg-blue-400" /> Volume spike</span>
        <span className="ml-auto">{n} bars · hover the chart, or hover a timeline row to highlight it</span>
      </div>
    </div>
  );
}

function Journey({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<JourneyRange>("1d");
  const [data, setData] = useState<JourneyData | null>(null);
  const [status, setStatus] = useState<"loading" | "online" | "stale" | "error">("loading");
  const [error, setError] = useState<{ kind: StockApiError["kind"]; message: string } | null>(null);
  const [focus, setFocus] = useState<Focus>(null);

  // Clear on symbol/range change; keep the last good data if a later refresh fails.
  useEffect(() => {
    let controller: AbortController | null = null;
    let hasData = false;
    setData(null);
    setStatus("loading");
    setError(null);
    setFocus(null);

    const load = async () => {
      if (document.hidden && hasData) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await getJourney(symbol, range, controller.signal);
        hasData = true;
        setData(next);
        setStatus("online");
        setError(null);
      } catch (failure) {
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        const known = failure instanceof StockApiError ? failure : new StockApiError("network", "Unable to reach the stock API");
        setError({ kind: known.kind, message: known.message });
        if (hasData) {
          setStatus("stale");
        } else {
          setData(null);
          setStatus("error");
        }
      }
    };

    load();
    const poll = range === "1d" || range === "5d" ? window.setInterval(load, 60_000) : undefined;
    return () => {
      controller?.abort();
      if (poll !== undefined) window.clearInterval(poll);
    };
  }, [symbol, range]);

  // Never render data that belongs to another symbol/range, even for one frame.
  const current = data && data.symbol.toUpperCase() === symbol.toUpperCase() && data.range === range ? data : null;
  const c = current?.currency ?? "USD";
  const chip =
    status === "online"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
      : status === "error"
        ? "border-rose-500/20 bg-rose-500/10 text-rose-400"
        : "border-amber-500/20 bg-amber-500/10 text-amber-400";

  const yearPosition =
    current && current.yearHigh !== null && current.yearLow !== null && current.yearHigh > current.yearLow
      ? Math.min(100, Math.max(0, ((current.close - current.yearLow) / (current.yearHigh - current.yearLow)) * 100))
      : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex rounded-lg border border-slate-800 bg-slate-950/70 p-1" role="group" aria-label="Journey range">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={range === item.id}
              onClick={() => setRange(item.id)}
              className={`cursor-pointer rounded px-3 py-1.5 text-xs font-bold transition ${range === item.id ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider ${chip}`}>
          <span className={`size-1.5 rounded-full ${status === "online" ? "bg-emerald-400" : status === "error" ? "bg-rose-400" : "animate-pulse bg-amber-400"}`} />
          Journey {status}
        </div>
      </div>

      {!current ? (
        <div className="flex min-h-72 flex-col items-center justify-center px-6 py-10 text-center">
          <div className={`mb-4 size-10 rounded-xl border ${status === "loading" ? "animate-pulse border-amber-500/30 bg-amber-500/10" : "border-rose-500/30 bg-rose-500/10"}`} />
          <div className="text-sm font-bold text-slate-300">
            {status === "loading" ? `Loading the ${symbol} journey` : error?.kind === "network" ? "Python stock API unavailable" : `Couldn't load the ${symbol} journey`}
          </div>
          <div className="mt-2 max-w-xl text-xs leading-relaxed text-slate-500">
            {status === "loading"
              ? "Fetching price history and working out the highs, lows and swings."
              : error?.kind === "network"
                ? "Start the Python service (uvicorn main:app in market-data/). If it is already running, restart it: the journey endpoint is part of the latest market-data code."
                : error?.message}
          </div>
        </div>
      ) : (
        <div className="space-y-6 p-4">
          {status === "stale" && error && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400" role="status">
              Showing last good data. The latest refresh failed: {error.message}
            </div>
          )}

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-800 bg-slate-800 lg:grid-cols-6">
            <Tile label="Period change" value={money(current.close, c)} valueClass={tone(current.change)} sub={`${pct(current.changePercent)} from ${money(current.open, c)} · ${current.periodStart.label} to ${current.periodEnd.label}`} />
            <Tile label="Low / high" value={`${current.low.price.toFixed(2)} – ${current.high.price.toFixed(2)}`} sub={`${current.rangePercent.toFixed(2)}% range · low ${current.low.label}, high ${current.high.label}`} />
            <Tile
              label="Biggest fall"
              value={current.maxDrawdown ? pct(current.maxDrawdown.percent) : "No pullback"}
              valueClass={current.maxDrawdown ? "text-rose-400" : "text-slate-300"}
              sub={current.maxDrawdown ? `${current.maxDrawdown.start.label} to ${current.maxDrawdown.end.label} · ${current.maxDrawdown.recovered && current.maxDrawdown.recoveredAt ? `recovered ${current.maxDrawdown.recoveredAt.label}` : "not recovered"}` : "The price never closed below an earlier close."}
            />
            <Tile
              label="Biggest rise"
              value={current.maxRunUp ? pct(current.maxRunUp.percent) : "No rise"}
              valueClass={current.maxRunUp ? "text-emerald-400" : "text-slate-300"}
              sub={current.maxRunUp ? `${current.maxRunUp.start.label} to ${current.maxRunUp.end.label}` : "The price never closed above a later low."}
            />
            <Tile label="Volume" value={compact(current.volume.total)} sub={`${compact(current.volume.averagePerBar)} average per ${current.interval} bar`} />
            <Tile
              label="VWAP"
              value={current.vwap !== null ? money(current.vwap, c) : DASH}
              sub={current.vwap !== null ? `Close is ${current.close >= current.vwap ? "above" : "below"} VWAP by ${Math.abs(((current.close - current.vwap) / current.vwap) * 100).toFixed(2)}%` : "No volume reported."}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <JourneyChart data={current} focus={focus} />
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">The story, in order</div>
                <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-1 font-mono text-[10px] font-bold tracking-wider text-slate-400">{current.storyMethod.toUpperCase()}</span>
              </div>
              <ol className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {current.timeline.map((event, index) => {
                  const style = KIND_STYLE[event.kind];
                  return (
                    <li key={`${event.kind}-${event.time}-${index}`}>
                      <button
                        type="button"
                        onMouseEnter={() => setFocus({ from: event.time, to: event.endTime ?? event.time })}
                        onMouseLeave={() => setFocus(null)}
                        onFocus={() => setFocus({ from: event.time, to: event.endTime ?? event.time })}
                        onBlur={() => setFocus(null)}
                        className="flex w-full cursor-default items-start gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition hover:border-slate-700 hover:bg-slate-800/50 focus-visible:border-slate-600"
                      >
                        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${style.dot}`} />
                        <span>
                          <span className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
                            <span className={`font-bold ${style.tag}`}>{style.name}</span>
                            {event.label}
                          </span>
                          <span className="mt-0.5 block text-xs leading-snug text-slate-300">{event.text}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-800 bg-slate-800 lg:grid-cols-4">
            <Tile label="Up / down / flat bars" value={`${current.bars.up} / ${current.bars.down} / ${current.bars.flat}`} sub={`${current.interval} bars, close versus open`} />
            <Tile label="Volatility" value={current.volatility.perBarPercent !== null ? `${current.volatility.perBarPercent.toFixed(3)}%` : DASH} sub={`Std dev of close-to-close change per ${current.volatility.barLabel} bar`} />
            <Tile label="Biggest up bar" value={current.biggestBar.up ? pct(current.biggestBar.up.percent) : DASH} valueClass="text-emerald-400" sub={current.biggestBar.up?.label ?? "No rising bar"} />
            <Tile label="Biggest down bar" value={current.biggestBar.down ? pct(current.biggestBar.down.percent) : DASH} valueClass="text-rose-400" sub={current.biggestBar.down?.label ?? "No falling bar"} />
            <Tile label="Gap vs previous close" value={current.gapPercent !== null ? pct(current.gapPercent) : DASH} valueClass={current.gapPercent !== null ? tone(current.gapPercent) : "text-white"} sub={current.gapPercent !== null ? "Opening price against yesterday's close" : "Only defined for the 1D view"} />
            <Tile
              label="52-week range"
              value={current.yearLow !== null && current.yearHigh !== null ? `${current.yearLow.toFixed(2)} – ${current.yearHigh.toFixed(2)}` : DASH}
              sub={yearPosition !== null ? `Close sits at ${yearPosition.toFixed(0)}% of that range` : "Not provided by Yahoo for this symbol"}
            />
            <Tile
              label="Volume spikes"
              value={String(current.volume.spikes.length)}
              sub={current.volume.spikes.length > 0 ? `Strongest ${Math.max(...current.volume.spikes.map((s) => s.multiple)).toFixed(1)}x the average bar` : "No bar stood out from the rest"}
            />
            <Tile label="Bars analysed" value={String(current.barCount)} sub={`Times in ${current.timezone}`} />
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Trading activity</div>
              <span className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-1 font-mono text-[10px] font-bold tracking-wider text-blue-400">NEEDS LEDGER</span>
            </div>
            <div data-testid="ledger" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-dashed border-slate-700 bg-slate-800/60 sm:grid-cols-5">
              {LEDGER_FIELDS.map((field) => (
                <div key={field} className="bg-slate-900/60 px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{field}</div>
                  <div className="mt-1.5 font-mono text-lg font-black text-slate-600">{DASH}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-500">
              Yahoo publishes total volume only, not who bought or sold, so these stay empty on purpose. They fill in once the paper-trading ledger records fills from the order ticket.
            </p>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-600">{current.dataNote}</p>
        </div>
      )}
    </div>
  );
}

export default memo(Journey);
