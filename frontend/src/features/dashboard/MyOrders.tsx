// "My orders": Kapinza's orders and fills, read from the database through exchange-api.
// Nothing here is kept in the browser: every row is fetched again every couple of seconds.
import { useCallback, useEffect, useState } from "react";
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
  type OrderStatus,
  type StoredOrder,
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

export function MyOrders({ online }: { online: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [orders, fills] = await Promise.all([getOrders(MANUAL_TRADER_ID), getFills(MANUAL_TRADER_ID)]);
      setData({ orders, fills });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Amend: lower the quantity at the same price (keeps the place in the queue) or give a new price or a bigger
  // quantity (cancel plus a new order: the place in the queue is lost).
  const [editing, setEditing] = useState<{ id: number; qty: string; price: string; remaining: number; cents: number } | null>(null);
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
    <Panel
      title={`My orders (${MANUAL_TRADER_NAME})`}
      description="Orders placed from the order ticket and what happened to them. Rows come from the database, not from this page."
      action={<Badge kind="simulated" label="PAPER MONEY" />}
    >
      {!data ? (
        <Notice tone="empty" title={failed ? "Orders are not available" : "Loading orders…"}>
          {failed ? "exchange-api is not reachable. Start the stack with ./build.sh and your orders appear here." : "Asking exchange-api for your orders."}
        </Notice>
      ) : data.orders.length === 0 ? (
        <Notice tone="empty" title="No orders yet">
          {online ? "Place an order with the ticket above and it shows up here with its status." : "The engine is not connected, so no order can be placed yet."}
        </Notice>
      ) : (
        <div className="space-y-4 p-4">
          {note && <p role="status" className="text-sm text-down">{note}</p>}
          {editing && (
            <form className="flex flex-wrap items-end gap-3 rounded border border-line p-3 text-sm" onSubmit={(e) => { e.preventDefault(); void applyAmend(); }}>
              <span className="text-strong">Amend order #{editing.id}</span>
              <label className="flex flex-col text-xs text-muted">Shares left
                <input aria-label="New remaining shares" className="w-24 rounded border border-line bg-surface px-2 py-1 font-mono text-sm text-strong" value={editing.qty} onChange={(e) => setEditing({ ...editing, qty: e.target.value })} inputMode="numeric" />
              </label>
              <label className="flex flex-col text-xs text-muted">Limit price
                <input aria-label="New limit price" className="w-28 rounded border border-line bg-surface px-2 py-1 font-mono text-sm text-strong" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} inputMode="decimal" />
              </label>
              <button type="submit" className={buttonClass}>Apply</button>
              <button type="button" className={buttonClass} onClick={() => setEditing(null)}>Close</button>
              <p className="basis-full text-xs text-muted">A lower quantity at the same price keeps your place in the queue. A new price or a bigger quantity cancels the order and places a new one at the back.</p>
            </form>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Orders placed by {MANUAL_TRADER_NAME}</caption>
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
                      {(o.status === "open" || o.status === "partially_filled") && (
                        <span className="inline-flex gap-1">
                          <button type="button" className={buttonClass} onClick={() => setEditing({ id: o.order_id, qty: String(o.quantity - o.filled), price: (o.price_cents / 100).toFixed(2), remaining: o.quantity - o.filled, cents: o.price_cents })}>Amend</button>
                          <button type="button" className={buttonClass} onClick={() => void cancel(o.order_id)}>Cancel</button>
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
              <p className="text-sm text-muted">No fills yet. A fill appears when someone trades against one of your orders.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <caption className="sr-only">Fills of {MANUAL_TRADER_NAME}'s orders</caption>
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Time</th>
                      <th className="py-1 pr-3 font-medium">You</th>
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
