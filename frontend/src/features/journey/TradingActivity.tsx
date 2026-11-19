// Trading activity for the stock chosen in the Journey tab. Computed by exchange-api from the fills in the database.
import { useEffect, useState } from "react";
import { activityFields } from "@/lib/activity";
import { EXCHANGE_SYMBOLS, MANUAL_TRADER_ID, MANUAL_TRADER_NAME, getActivity, getTraders, type Activity, type Trader } from "@/lib/exchangeApi";

const POLL_MS = 3000;

export function TradingActivity({ symbol }: { symbol: string }) {
  const [traderId, setTraderId] = useState(MANUAL_TRADER_ID);
  const [traders, setTraders] = useState<Trader[]>([]);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [failed, setFailed] = useState(false);
  const supported = (EXCHANGE_SYMBOLS as readonly string[]).includes(symbol.toUpperCase());

  useEffect(() => {
    getTraders().then(setTraders).catch(() => undefined);
  }, []);

  useEffect(() => {
    setActivity(null);
    if (!supported) return;
    let live = true;
    const load = () =>
      getActivity(traderId, symbol.toUpperCase())
        .then((a) => { if (live) { setActivity(a); setFailed(false); } })
        .catch(() => { if (live) setFailed(true); });
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [traderId, symbol, supported]);

  const shown = activity && activity.symbol === symbol.toUpperCase() ? activity : null;
  const fields = shown && shown.fills > 0 ? activityFields(shown) : null;
  const who = traderId === MANUAL_TRADER_ID ? MANUAL_TRADER_NAME : traders.find((t) => t.trader_id === traderId)?.name ?? `Trader ${traderId}`;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-faint">Trading activity · {symbol.toUpperCase()} · simulated</div>
        <select
          aria-label="Trader"
          value={traderId}
          onChange={(e) => setTraderId(Number(e.target.value))}
          className="rounded border border-line bg-surface px-2 py-1 text-xs text-strong"
        >
          <option value={MANUAL_TRADER_ID}>{MANUAL_TRADER_NAME} (you)</option>
          {traders.filter((t) => t.trader_id !== MANUAL_TRADER_ID).map((t) => (
            <option key={t.trader_id} value={t.trader_id}>{t.name}</option>
          ))}
        </select>
      </div>
      {!supported ? (
        <p data-testid="ledger" className="rounded-xl border border-line bg-surface/60 px-4 py-3 text-xs text-faint">
          The paper exchange only lists {EXCHANGE_SYMBOLS.join(", ")}, so there is no trading activity for {symbol}.
        </p>
      ) : failed && !shown ? (
        <p data-testid="ledger" className="rounded-xl border border-line bg-surface/60 px-4 py-3 text-xs text-faint">
          The exchange API is not reachable, so activity cannot be shown. Start the stack with ./build.sh.
        </p>
      ) : !shown ? (
        <p data-testid="ledger" className="rounded-xl border border-line bg-surface/60 px-4 py-3 text-xs text-faint">Loading activity.</p>
      ) : !fields ? (
        <p data-testid="ledger" className="rounded-xl border border-line bg-surface/60 px-4 py-3 text-xs text-faint">
          {traderId === MANUAL_TRADER_ID
            ? "Place an order as Kapinza to see activity"
            : `${who} has no fills in ${symbol.toUpperCase()} yet.`}
        </p>
      ) : (
        <div data-testid="ledger" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-raised sm:grid-cols-5">
          {fields.map((f) => (
            <div key={f.label} className="bg-surface/60 px-4 py-3">
              <div className="text-xs font-semibold text-faint">{f.label}</div>
              <div className={`mt-1.5 font-mono text-lg font-semibold ${f.tone === "up" ? "text-up" : f.tone === "down" ? "text-down" : "text-strong"}`}>{f.value}</div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 max-w-3xl text-xs leading-relaxed text-faint">
        Paper trades, computed from {who}'s fills with FIFO lots. Unrealized P&L uses the engine's last price{shown?.last_price_cents != null ? ` (${(shown.last_price_cents / 100).toFixed(2)})` : ""}. Simulated values, not real money.
      </p>
    </div>
  );
}
