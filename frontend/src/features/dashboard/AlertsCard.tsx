// Price alerts: "tell me when SYMBOL goes above or below a price". An alert fires once and stays in the list
// with its fire time. A toast appears when an alert fires while the page is open.
import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, Panel, buttonClass, inputClass } from "@/components/ui";
import { EXCHANGE_SYMBOLS, EXCHANGE_URL } from "@/lib/exchangeApi";
import { dollars, parseCents } from "@/lib/format";

export type PriceAlert = {
  alert_id: number; symbol: string; direction: "above" | "below"; price_cents: number;
  created_ms: number; fired_ms: number | null; fired_price_cents: number | null;
};

export const alertText = (a: PriceAlert) => `${a.symbol} ${a.direction} ${dollars(a.price_cents)}`;

/** Ids that are fired now but were not fired in the previous list (the first list never produces toasts). */
export function newlyFired(previous: PriceAlert[] | null, next: PriceAlert[]): PriceAlert[] {
  if (previous === null) return [];
  const before = new Set(previous.filter((a) => a.fired_ms !== null).map((a) => a.alert_id));
  return next.filter((a) => a.fired_ms !== null && !before.has(a.alert_id));
}

export function AlertsView({ alerts, error, toasts, problem, symbol, direction, price, onSymbol, onDirection, onPrice, onCreate, onDelete, onDismiss }: {
  alerts: PriceAlert[] | null; error: string; toasts: PriceAlert[]; problem: string;
  symbol: string; direction: string; price: string;
  onSymbol: (s: string) => void; onDirection: (d: string) => void; onPrice: (p: string) => void;
  onCreate: () => void; onDelete: (id: number) => void; onDismiss: (id: number) => void;
}) {
  return (
    <>
      <Panel title="Price alerts" description="Each alert fires once, when the last or reference price reaches your price.">
        <form className="flex flex-wrap items-end gap-3 p-4" onSubmit={(e) => { e.preventDefault(); onCreate(); }}>
          <label className="text-xs text-muted">Symbol
            <select className={`${inputClass} mt-1`} value={symbol} onChange={(e) => onSymbol(e.target.value)}>
              {EXCHANGE_SYMBOLS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">When the price goes
            <select className={`${inputClass} mt-1`} value={direction} onChange={(e) => onDirection(e.target.value)}>
              <option value="above">above</option><option value="below">below</option>
            </select>
          </label>
          <label className="text-xs text-muted">Price (USD)
            <input className={`${inputClass} mt-1 w-28`} inputMode="decimal" value={price} onChange={(e) => onPrice(e.target.value)} />
          </label>
          <button type="submit" className={buttonClass}>Add alert</button>
        </form>
        {problem && <p className="px-4 pb-3 text-sm text-down">{problem}</p>}
        {error && <p className="px-4 pb-3 text-sm text-down">{error}</p>}
        {alerts === null && !error ? (
          <p className="px-4 pb-4 text-sm text-muted">Loading alerts…</p>
        ) : alerts && alerts.length === 0 ? (
          <Notice tone="empty" title="No alerts yet">Add one above, for example AAPL above a price a little over the reference price.</Notice>
        ) : (
          <ul className="divide-y divide-line border-t border-line text-sm" aria-label="Alerts">
            {(alerts ?? []).map((a) => (
              <li key={a.alert_id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="font-mono text-strong">{alertText(a)}</span>
                {a.fired_ms !== null
                  ? <span className="text-up">Fired {new Date(a.fired_ms).toLocaleTimeString()} at {dollars(a.fired_price_cents ?? a.price_cents)}</span>
                  : <span className="text-muted">Waiting</span>}
                <button type="button" className={`${buttonClass} ml-auto`} onClick={() => onDelete(a.alert_id)} aria-label={`Delete alert ${alertText(a)}`}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((a) => (
          <div key={a.alert_id} role="status" className="pointer-events-auto flex items-center gap-3 rounded-md border border-line-strong bg-raised px-4 py-2 text-sm text-strong shadow-lg">
            Alert: {alertText(a)} fired at {dollars(a.fired_price_cents ?? a.price_cents)}
            <button type="button" className="text-muted hover:text-strong" onClick={() => onDismiss(a.alert_id)} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </>
  );
}

export function AlertsCard() {
  const [alerts, setAlerts] = useState<PriceAlert[] | null>(null);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<PriceAlert[]>([]);
  const [problem, setProblem] = useState("");
  const [symbol, setSymbol] = useState("AAPL");
  const [direction, setDirection] = useState("above");
  const [price, setPrice] = useState("");
  const previous = useRef<PriceAlert[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${EXCHANGE_URL}/alerts`);
      if (!res.ok) throw new Error(String(res.status));
      const next = ((await res.json()) as { alerts: PriceAlert[] }).alerts;
      const fired = newlyFired(previous.current, next);
      previous.current = next;
      setAlerts(next);
      setError("");
      if (fired.length) {
        setToasts((t) => [...t, ...fired]);
        for (const a of fired) globalThis.setTimeout(() => setToasts((t) => t.filter((x) => x.alert_id !== a.alert_id)), 10_000);
      }
    } catch {
      setError("Alerts are not available: exchange-api is not reachable.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = globalThis.setInterval(() => { if (!document.hidden) void load(); }, 2000);
    return () => globalThis.clearInterval(timer);
  }, [load]);

  const create = async () => {
    const cents = parseCents(price);
    if (cents === null) { setProblem("Price must be an amount greater than 0 with at most 2 decimals, like 195.50."); return; }
    setProblem("");
    try {
      const res = await fetch(`${EXCHANGE_URL}/alerts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, direction, price: cents }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
        setProblem(typeof body.detail === "string" ? `The alert was refused: ${body.detail}.` : "The alert was refused.");
        return;
      }
      setPrice("");
      await load();
    } catch {
      setProblem("The alert could not be saved: exchange-api is not reachable.");
    }
  };
  const remove = async (id: number) => {
    await fetch(`${EXCHANGE_URL}/alerts/${id}`, { method: "DELETE" }).catch(() => undefined);
    await load();
  };

  return (
    <AlertsView alerts={alerts} error={error} toasts={toasts} problem={problem} symbol={symbol} direction={direction} price={price}
      onSymbol={setSymbol} onDirection={setDirection} onPrice={setPrice} onCreate={create} onDelete={remove}
      onDismiss={(id) => setToasts((t) => t.filter((x) => x.alert_id !== id))} />
  );
}
