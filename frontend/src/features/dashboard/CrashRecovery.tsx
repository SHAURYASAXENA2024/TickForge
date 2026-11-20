// "Crash recovery": live write-ahead-log numbers, and a button that kills the engine with SIGKILL and
// shows whether the log brought back exactly the same state. Everything shown comes from
// GET /recovery/status and the answer of POST /recovery/crash-demo; nothing is typed in here.
import { useCallback, useEffect, useState } from "react";
import { fmtInt } from "@/lib/format";
import { Notice, Panel, buttonClass, primaryButtonClass } from "@/components/ui";

const EXCHANGE_URL = (import.meta.env.VITE_EXCHANGE_API_URL || "http://127.0.0.1:8001").replace(/\/$/, "");

export const DEMO_OFF_MESSAGE = "Start with TICKFORGE_DEMO=1 to enable the crash demo";
export const CRASH_NOTE = "Protects against a process crash, not power loss (no fsync).";

type Field = { before: unknown; after: unknown; match: boolean };

export type DemoResult = {
  result: "PASS" | "FAIL";
  differing: string[];
  error?: string;
  fields?: Record<string, Field>;
  frames_replayed?: number;
  duration_ms?: number;
  total_ms?: number;
};

export type RecoveryStatus = {
  engine: {
    wal_bytes: number;
    frames_written: number;
    last_sequence: number;
    state_hash: string;
    crc_errors: number;
    last_recovery: { frames_replayed: number; duration_ms: number; recovered_at: number };
  } | null;
  engine_error: string;
  supervisor: { supervised: boolean; restart_on_crash: boolean; engine_alive: boolean; restarts: number };
  demo_enabled: boolean;
  demo: { running: boolean; phase: string; last: DemoResult | null };
};

const STEPS = ["Running", "Killed", "Replaying", "Recovered"] as const;

/** Which of the four timeline steps is current, from the phase exchange-api reports. */
export function stepIndex(phase: string, finished: boolean): number {
  if (finished) return 3;
  if (phase === "killed") return 1;
  if (phase === "replaying" || phase === "snapshot_after") return 2;
  return 0;
}

export function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${fmtInt(n)} B`;
}

const fmtMs = (ms: number) => (ms < 1 ? "under 1" : fmtInt(ms));

function show(key: string, value: unknown): string {
  if (Array.isArray(value)) return `${value.length} levels`;
  if (typeof value === "string" && key === "state_hash") return value.slice(0, 8);
  if (typeof value === "number") return fmtInt(value);
  return value === undefined || value === null ? "none" : String(value);
}

type Row = { label: string; before: string; after: string; match: boolean; title?: string };

/** One table row per thing compared: scalars one by one, order books per symbol, traders as a group. */
export function buildRows(fields: Record<string, Field>): Row[] {
  const rows: Row[] = [];
  const books = new Map<string, Field[]>();
  const traders = new Map<string, Field[]>();
  for (const [key, f] of Object.entries(fields)) {
    const parts = key.split(".");
    if (parts[0] === "books") books.set(parts[1], [...(books.get(parts[1]) ?? []), f]);
    else if (parts[0] === "cash") traders.set(parts[1], [...(traders.get(parts[1]) ?? []), f]);
    else {
      const label = key.replace("orders_by_status.", "orders ").replace(/_/g, " ");
      rows.push({ label, before: show(key, f.before), after: show(key, f.after), match: f.match, title: key === "state_hash" ? `${f.before} / ${f.after}` : undefined });
    }
  }
  for (const [symbol, list] of books) {
    const levels = (side: "before" | "after") => list.reduce((n, f) => n + (Array.isArray(f[side]) ? (f[side] as unknown[]).length : 0), 0);
    rows.push({ label: `book, top 5 levels, ${symbol}`, before: `${levels("before")} levels`, after: `${levels("after")} levels`, match: list.every((f) => f.match) });
  }
  for (const [name, list] of traders) {
    if (name === "Kapinza") rows.push({ label: "cash and reserved cash, Kapinza", before: show("n", list[0].before), after: show("n", list[0].after), match: list.every((f) => f.match) });
  }
  const others = [...traders].filter(([name]) => name !== "Kapinza");
  if (others.length > 0) {
    const ok = others.filter(([, list]) => list.every((f) => f.match)).length;
    rows.push({ label: `cash and reserved cash, ${others.length} virtual traders`, before: `${others.length} accounts`, after: `${ok} of ${others.length} match`, match: ok === others.length });
  }
  return rows;
}

type ViewProps = {
  status: RecoveryStatus | null;
  error: string;
  result: DemoResult | null;
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/** The panel without any hooks, so a test can render each state. */
export function RecoveryView({ status, error, result, busy, confirming, onAsk, onConfirm, onCancel }: ViewProps) {
  const engine = status?.engine ?? null;
  const running = busy || (status?.demo.running ?? false);
  const finished = !running && result !== null;
  const step = stepIndex(status?.demo.phase ?? "idle", finished);
  const enabled = status?.demo_enabled ?? false;
  const stats: [string, string, string?][] = [
    ["WAL size", engine ? fmtBytes(engine.wal_bytes) : "none"],
    ["Frames written", engine ? fmtInt(engine.frames_written) : "none"],
    ["Last sequence", engine ? fmtInt(engine.last_sequence) : "none"],
    ["State hash", engine ? engine.state_hash.slice(0, 8) : "none", engine?.state_hash],
    ["CRC errors", engine ? fmtInt(engine.crc_errors) : "none"],
    ["Restarts", status ? fmtInt(status.supervisor.restarts) : "none"],
  ];
  return (
    <Panel
      title="Crash recovery"
      description="Kill the engine with SIGKILL and watch the write-ahead log bring back the same state."
      action={
        confirming ? (
          <>
            <span className="text-xs text-muted">Kill the engine now?</span>
            <button type="button" className={primaryButtonClass} onClick={onConfirm}>Confirm crash</button>
            <button type="button" className={buttonClass} onClick={onCancel}>Cancel</button>
          </>
        ) : (
          <button type="button" className={buttonClass} disabled={!enabled || running || !status} onClick={onAsk}>
            {running ? "Crashing..." : "Crash engine"}
          </button>
        )
      }
    >
      {error && !status ? (
        <Notice tone="error" title="Could not read the recovery status">
          {`${error}. Is exchange-api running on port 8001?`}
        </Notice>
      ) : !status ? (
        <Notice tone="loading" title="Reading the recovery status" />
      ) : (
        <>
          {error && <p role="alert" className="border-b border-line px-4 py-2 text-xs text-down">Status refresh failed: {error}</p>}
          <dl className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
            {stats.map(([label, value, full]) => (
              <div key={label} className="bg-surface px-4 py-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd title={full} className={`mt-0.5 font-mono text-lg font-medium ${engine ? "text-strong" : "text-faint"}`}>{value}</dd>
              </div>
            ))}
          </dl>
          {status.engine_error && <p role="alert" className="border-b border-line px-4 py-2 text-xs text-warn">{status.engine_error}</p>}
          {!enabled && <p className="border-b border-line px-4 py-2 text-sm text-muted">{DEMO_OFF_MESSAGE}</p>}
          <ol className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4" aria-label="Crash timeline">
            {STEPS.map((name, i) => (
              <li key={name} aria-current={i === step && (running || finished) ? "step" : undefined} className="bg-surface px-4 py-2 text-sm">
                <span className={i < step || (i === step && (running || finished)) ? "font-medium text-strong" : "text-faint"}>{name}</span>
              </li>
            ))}
          </ol>
          {result && !running && <ResultView result={result} />}
        </>
      )}
      <p className="px-4 py-3 text-xs text-muted">{CRASH_NOTE}</p>
    </Panel>
  );
}

function ResultView({ result }: { result: DemoResult }) {
  const pass = result.result === "PASS";
  const rows = result.fields ? buildRows(result.fields) : [];
  return (
    <div>
      <div role="status" className={`border-b border-line px-4 py-4 text-center font-mono text-3xl font-semibold ${pass ? "text-up" : "text-down"}`}>
        {pass ? "PASS" : "FAIL"}
      </div>
      {result.error && <p role="alert" className="px-4 py-2 text-sm text-down">{result.error}</p>}
      {!pass && result.differing.length > 0 && <p className="px-4 py-2 text-sm text-down">{`Differs: ${result.differing.join(", ")}`}</p>}
      {result.frames_replayed !== undefined && result.duration_ms !== undefined && (
        <p className="px-4 py-2 text-sm text-fg">
          {`Replayed ${fmtInt(result.frames_replayed)} frames in ${fmtMs(result.duration_ms)} ms`}
        </p>
      )}
      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Compared</th>
              <th className="px-4 py-2 font-medium">Before crash</th>
              <th className="px-4 py-2 font-medium">After recovery</th>
              <th className="px-4 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} title={row.title} className="border-b border-line last:border-0">
                <td className="px-4 py-1.5 text-fg">{row.label}</td>
                <td className="px-4 py-1.5 font-mono text-strong">{row.before}</td>
                <td className="px-4 py-1.5 font-mono text-strong">{row.after}</td>
                <td className={`px-4 py-1.5 font-medium ${row.match ? "text-up" : "text-down"}`}>{row.match ? "✓ match" : "✗ mismatch"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function CrashRecovery() {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DemoResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const running = busy || (status?.demo.running ?? false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${EXCHANGE_URL}/recovery/status`);
      if (!res.ok) throw new Error(`exchange-api answered ${res.status}`);
      const body = (await res.json()) as RecoveryStatus;
      setStatus(body);
      setError("");
      setResult((current) => current ?? body.demo.last);
    } catch (e) {
      setError(e instanceof Error ? e.message : "exchange-api is not reachable");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), running ? 250 : 1000);
    return () => clearInterval(timer);
  }, [refresh, running]);

  const crash = async () => {
    setConfirming(false);
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${EXCHANGE_URL}/recovery/crash-demo`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) setResult({ result: "FAIL", differing: [], error: String(body?.detail ?? `exchange-api answered ${res.status}`) });
      else setResult(body as DemoResult);
    } catch (e) {
      setResult({ result: "FAIL", differing: [], error: e instanceof Error ? e.message : "request failed" });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <RecoveryView status={status} error={error} result={result} busy={busy} confirming={confirming}
      onAsk={() => setConfirming(true)} onConfirm={() => void crash()} onCancel={() => setConfirming(false)} />
  );
}
