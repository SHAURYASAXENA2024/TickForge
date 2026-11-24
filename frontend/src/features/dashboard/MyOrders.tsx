// "My orders": Kapinza's orders and fills, read from the database through exchange-api.
// Nothing here is kept in the browser: every row is fetched again every couple of seconds.
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Notice, Panel, buttonClass } from "@/components/ui";
import { DASH, dollars, fmtInt, parseCents } from "@/lib/format";
import {
  MANUAL_TRADER_ID,
  MANUAL_TRADER_NAME,
  OrderRejected,
  REJECT_TEXT,
  amendOrder,
  cancelOrder,
  getFills,
  getOrders,
  getTraders,
  type OrderStatus,
  type StoredOrder,
  type Trader,
  type TraderFill,
} from "@/lib/exchangeApi";

const POLL_MS = 2000;

const STATUS_TEXT: Record<OrderStatus, string> = {
  open: "Open",
  partially_filled: "Partly filled",
  filled: "Filled",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  open: "text-accent",
  partially_filled: "text-warn",
  filled: "text-up",
  cancelled: "text-muted",
  rejected: "text-down",
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false });

type Data = { orders: StoredOrder[]; fills: TraderFill[] };

/** Kapinza first, then the virtual traders by name. */
export function traderOptions(traders: Trader[]): { id: number; name: string }[] {
  const virtual = traders.filter((t) => t.trader_id !== MANUAL_TRADER_ID).sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ id: t.trader_id, name: t.name }));
  return [{ id: MANUAL_TRADER_ID, name: MANUAL_TRADER_NAME }, ...virtual];
}

/** Orders and fills of one trader, through the existing helpers. */
export const fetchTraderData = async (traderId: number, api = { getOrders, getFills }): Promise<Data> => {
  const [orders, fills] = await Promise.all([api.getOrders(traderId), api.getFills(traderId)]);
  return { orders, fills };
};

/** Remembers which key was asked for last, so an answer for an earlier key can be ignored. */
export function latestKey<K>() {
  let current: K | undefined;
  return { set: (k: K) => void (current = k), isCurrent: (k: K) => current === k };
}

export function MyOrders({ online }: { online: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [traders, setTraders] = useState<Trader[]>([]);
  const [traderId, setTraderId] = useState(MANUAL_TRADER_ID);
  const guard = useRef(latestKey<number>());
  const options = traderOptions(traders);
  const name = options.find((o) => o.id === traderId)?.name ?? MANUAL_TRADER_NAME;
  const readOnly = traderId !== MANUAL_TRADER_ID;

  useEffect(() => {
    getTraders().then(setTraders).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    const id = traderId;
    try {
      const next = await fetchTraderData(id);
      if (!guard.current.isCurrent(id)) return; // a late answer for a trader that is no longer selected
      setData(next);
      setFailed(false);
    } catch {
      if (guard.current.isCurrent(id)) setFailed(true);
    }
  }, [traderId]);

  useEffect(() => {
    guard.current.set(traderId);
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, traderId]);

  const select = (id: number) => {
    setData(null); // clear the old rows and show the loading state
    setFailed(false);
    setNote(null);
    setEditing(null);
    setTraderId(id);
  };

  // Amend: lower the quantity at the same price (keeps the place in the queue) or give a new price or a bigger
  // quantity (cancel plus a new order: the place in the queue is lost).
  const [editing, setEditing] = useState<Editing>(null);
  const applyAmend = async () => {
    if (!editing) return;
    setNote(null);
    const qty = Number(editing.qty);
    const price = parseCents(editing.price);
    if (!Number.isInteger(qty) || qty <= 0 || price === null) {
      setNote("Enter a whole number of shares and a price such as 189.50.");
      return;
    }
    try {
      const r = await amendOrder(editing.id, { qty: qty === editing.remaining ? undefined : qty, price: price === editing.cents ? undefined : price });
      setNote(r.keeps_priority ? "Amended. The order keeps its place in the queue." : "Replaced with a new order at the back of the queue.");
      setEditing(null);
    } catch (e) {
      setNote(e instanceof OrderRejected ? REJECT_TEXT[e.reason] ?? `Not amended: ${e.reason.replace(/_/g, " ")}.` : "The order could not be amended.");
    }
    void load();
  };

  const cancel = async (orderId: number) => {
    setNote(null);
    try {
      await cancelOrder(orderId);
    } catch (e) {
      setNote(e instanceof OrderRejected ? REJECT_TEXT[e.reason] ?? `Not cancelled: ${e.reason}.` : "The order could not be cancelled.");
    }
    void load();
  };

  return (
    <OrdersPanel
      {...{ name, readOnly, options, traderId, data, failed, online, note, editing }}
      onSelect={select}
      onEdit={setEditing}
      onApply={() => void applyAmend()}
      onCancel={(id) => void cancel(id)}
    />
  );
}

type Editing = { id: number; qty: string; price: string; remaining: number; cents: number } | null;
type PanelProps = {
  name: string; readOnly: boolean; options: { id: number; name: string }[]; traderId: number; data: Data | null; failed: boolean;
  online: boolean; note: string | null; editing: Editing;
  onSelect: (id: number) => void; onEdit: (e: Editing) => void; onApply: () => void; onCancel: (orderId: number) => void;
};

/** The panel itself, without any loading: what the person sees for one trader. */
export function OrdersPanel({ name, readOnly, options, traderId, data, failed, online, note, editing, onSelect, onEdit, onApply, onCancel }: PanelProps) {
  return (
    <Panel
      title={`My orders (${name})`}
      description={readOnly ? `Orders placed by ${name}, a virtual trader. Read only. Rows come from the database, not from this page.` : "Orders placed from the order ticket and what happened to them. Rows come from the database, not from this page."}
      action={
        <span className="flex items-center gap-2">
          <select aria-label="Trader" className="rounded border border-line bg-surface px-2 py-1 text-sm text-strong" value={traderId} onChange={(e) => onSelect(Number(e.target.value))}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <Badge kind="simulated" label="PAPER MONEY" />
        </span>
      }
    >
      {!data ? (
        <Notice tone="empty" title={failed ? "Orders are not available" : "Loading orders…"}>
          {failed ? (readOnly ? `Could not load the orders of ${name}: exchange-api is not reachable.` : "exchange-api is not reachable. Start the stack with ./build.sh and your orders appear here.") : readOnly ? `Asking exchange-api for the orders of ${name}.` : "Asking exchange-api for your orders."}
        </Notice>
      ) : data.orders.length === 0 ? (
        <Notice tone="empty" title={readOnly ? `${name} has no orders yet` : "No orders yet"}>
          {readOnly ? "Virtual traders send orders on their own once the engine is running." : online ? "Place an order with the ticket above and it shows up here with its status." : "The engine is not connected, so no order can be placed yet."}
        </Notice>
      ) : (
        <div className="space-y-4 p-4">
          {note && !readOnly && <p role="status" className="text-sm text-down">{note}</p>}
          {editing && !readOnly && (
            <form className="flex flex-wrap items-end gap-3 rounded border border-line p-3 text-sm" onSubmit={(e) => { e.preventDefault(); onApply(); }}>
              <span className="text-strong">Amend order #{editing.id}</span>
              <label className="flex flex-col text-xs text-muted">Shares left
                <input aria-label="New remaining shares" className="w-24 rounded border border-line bg-surface px-2 py-1 font-mono text-sm text-strong" value={editing.qty} onChange={(e) => onEdit({ ...editing, qty: e.target.value })} inputMode="numeric" />
              </label>
              <label className="flex flex-col text-xs text-muted">Limit price
                <input aria-label="New limit price" className="w-28 rounded border border-line bg-surface px-2 py-1 font-mono text-sm text-strong" value={editing.price} onChange={(e) => onEdit({ ...editing, price: e.target.value })} inputMode="decimal" />
              </label>
              <button type="submit" className={buttonClass}>Apply</button>
              <button type="button" className={buttonClass} onClick={() => onEdit(null)}>Close</button>
              <p className="basis-full text-xs text-muted">A lower quantity at the same price keeps your place in the queue. A new price or a bigger quantity cancels the order and places a new one at the back.</p>
            </form>
          )}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Orders placed by {name}</caption>
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Order</th>
                  <th className="py-1 pr-3 font-medium">Side</th>
                  <th className="py-1 pr-3 font-medium">Symbol</th>
                  <th className="py-1 pr-3 text-right font-medium">Limit</th>
                  <th className="py-1 pr-3 text-right font-medium">Filled / shares</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.orders.map((o) => (
                  <tr key={o.order_id} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-muted">{o.status === "rejected" ? DASH : `#${o.order_id}`}</td>
                    <td className={`py-1.5 pr-3 ${o.side === "BUY" ? "text-up" : "text-down"}`}>{o.side === "BUY" ? "Buy" : "Sell"}</td>
                    <td className="py-1.5 pr-3 text-strong">{o.symbol}</td>
                    <td className="py-1.5 pr-3 text-right">{dollars(o.price_cents)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtInt(o.filled)} / {fmtInt(o.quantity)}</td>
                    <td className={`py-1.5 pr-3 font-sans ${STATUS_COLOR[o.status]}`}>
                      {STATUS_TEXT[o.status]}
                      {o.status === "rejected" && o.reason ? ` (${o.reason.replace(/_/g, " ")})` : ""}
                    </td>
                    <td className="py-1.5 text-right">
                      {!readOnly && (o.status === "open" || o.status === "partially_filled") && (
                        <span className="inline-flex gap-1">
                          <button type="button" className={buttonClass} onClick={() => onEdit({ id: o.order_id, qty: String(o.quantity - o.filled), price: (o.price_cents / 100).toFixed(2), remaining: o.quantity - o.filled, cents: o.price_cents })}>Amend</button>
                          <button type="button" className={buttonClass} onClick={() => onCancel(o.order_id)}>Cancel</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="mb-1 text-sm font-semibold text-strong">Fills</h4>
            {data.fills.length === 0 ? (
              <p className="text-sm text-muted">{readOnly ? `No fills yet for ${name}.` : "No fills yet. A fill appears when someone trades against one of your orders."}</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <caption className="sr-only">Fills of {name}'s orders</caption>
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Time</th>
                      <th className="py-1 pr-3 font-medium">{readOnly ? "Trader" : "You"}</th>
                      <th className="py-1 pr-3 font-medium">Symbol</th>
                      <th className="py-1 pr-3 text-right font-medium">Shares</th>
                      <th className="py-1 pr-3 text-right font-medium">Price</th>
                      <th className="py-1 font-medium">Counterparty</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {data.fills.map((f) => (
                      <tr key={`${f.trade_id}-${f.order_id}`} className="border-t border-line">
                        <td className="py-1.5 pr-3 text-muted">{clock(f.timestamp_ms)}</td>
                        <td className={`py-1.5 pr-3 ${f.side === "BUY" ? "text-up" : "text-down"}`}>{f.side === "BUY" ? "Bought" : "Sold"}</td>
                        <td className="py-1.5 pr-3 text-strong">{f.symbol}</td>
                        <td className="py-1.5 pr-3 text-right">{fmtInt(f.quantity)}</td>
                        <td className="py-1.5 pr-3 text-right">{dollars(f.price_cents)}</td>
                        <td className="py-1.5 font-sans text-fg">
                          {f.side === "BUY" ? "Sold by " : "Bought by "}
                          <span className="text-strong">{f.counterparty_name}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
