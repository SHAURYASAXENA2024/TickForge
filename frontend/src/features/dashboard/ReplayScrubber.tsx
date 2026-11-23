// Scrub through the write-ahead log: the book, trade count and state hash at any sequence number.
// The server replays a COPY of the WAL in a separate process; the live engine is not asked.
import { useEffect, useState } from "react";
import { Notice, Panel, inputClass } from "@/components/ui";
import { EXCHANGE_SYMBOLS, EXCHANGE_URL } from "@/lib/exchangeApi";
import { dollars } from "@/lib/format";

export type ReplayResult = {
  symbol: string; seq: number; newest_seq: number; trades: number; state_hash: string;
  bids: [number, number][]; asks: [number, number][];
};

export function ReplayView({ result, error, loading, seq, symbol, onSeq, onSymbol }: {
  result: ReplayResult | null; error: string; loading: boolean; seq: number | null; symbol: string;
  onSeq: (n: number) => void; onSymbol: (s: string) => void;
}) {
  const newest = result?.newest_seq ?? 0;
  const shown = seq ?? result?.seq ?? 0;
  const levels = (rows: [number, number][]) =>
    rows.length === 0 ? <li className="text-faint">none</li> : rows.map(([p, q]) => <li key={p} className="font-mono">{dollars(p)} × {q}</li>);
  return (
    <Panel title="Replay the log" description="Move the slider to see the book as it was at that point of the write-ahead log. Computed from a copy of the WAL, not from the live engine.">
      {error ? (
        <Notice tone="error" title="Replay not available">{error}</Notice>
      ) : !result ? (
        <Notice tone="loading" title="Reading the log">Replaying a copy of the WAL.</Notice>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-muted" htmlFor="replay-seq">Sequence {shown} of {newest}</label>
            <input id="replay-seq" type="range" min={0} max={newest} value={shown} onChange={(e) => onSeq(Number(e.target.value))} className="min-w-48 flex-1" aria-label="WAL sequence" />
            <select className={inputClass} value={symbol} onChange={(e) => onSymbol(e.target.value)} aria-label="Symbol">
              {EXCHANGE_SYMBOLS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-muted">Reached sequence</dt><dd className="font-mono text-strong">{result.seq}</dd></div>
            <div><dt className="text-xs text-muted">Trades so far</dt><dd className="font-mono text-strong">{result.trades}</dd></div>
            <div><dt className="text-xs text-muted">State hash</dt><dd className="truncate font-mono text-strong">{result.state_hash}</dd></div>
          </dl>
          <div className={`grid grid-cols-2 gap-4 text-sm ${loading ? "opacity-70" : ""}`}>
            <div><div className="text-xs text-muted">Top 5 bids</div><ul>{levels(result.bids)}</ul></div>
            <div><div className="text-xs text-muted">Top 5 asks</div><ul>{levels(result.asks)}</ul></div>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function ReplayScrubber() {
  const [symbol, setSymbol] = useState("AAPL");
  const [seq, setSeq] = useState<number | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${EXCHANGE_URL}/replay?symbol=${symbol}${seq === null ? "" : `&seq=${seq}`}`, { signal: controller.signal });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body?.detail === "string" ? body.detail : `exchange-api answered ${res.status}`);
        setResult(body as ReplayResult);
        setError("");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "exchange-api is not reachable");
      } finally {
        setLoading(false);
      }
    }, seq === null ? 0 : 250);
    return () => { controller.abort(); globalThis.clearTimeout(timer); };
  }, [symbol, seq]);

  return <ReplayView result={result} error={error} loading={loading} seq={seq} symbol={symbol} onSeq={setSeq} onSymbol={setSymbol} />;
}
