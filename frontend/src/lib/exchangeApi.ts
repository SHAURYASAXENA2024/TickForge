// REST and WebSocket helpers for exchange-api (port 8001). Prices are integer cents.
import { useEffect, useState } from "react";

export const EXCHANGE_URL = (import.meta.env.VITE_EXCHANGE_API_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
const EXCHANGE_WS = EXCHANGE_URL.replace(/^http/, "ws");

export const EXCHANGE_SYMBOLS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "JPM", "BRK-B", "AMD"] as const;

export type TradeSide = "BUY" | "SELL";

export type LiveTrade = {
  trade_id: number;
  symbol: string;
  price: number; // cents
  qty: number;
  buyer_id: number;
  seller_id: number;
  ts_ms: number;
};

export type Trader = {
  trader_id: number;
  name: string;
  strategy: string;
  cash: number; // cents, including the part that is reserved
  reserved_cash: number; // cents locked by open buy orders
  available_cash: number; // cents, cash minus reserved_cash
  holdings: Record<string, number>;
  reserved_shares: Record<string, number>; // shares locked by open sell orders
  realized_pnl: number; // cents
  equity: number; // cents, at the last trade prices
  trades: number;
  last_action: string;
  state?: ControlState; // "running" unless this trader was paused or stopped
};

/** Which virtual trader sends the next order. Absent from an older exchange-api. */
export type DispatchInfo = { mode: string; next_trader_id: number | null; turns: number };

export type ControlState = "running" | "paused" | "stopped";
export type ControlAction = "pause" | "resume" | "stop";

/** The manual trader behind the order ticket. */
export const MANUAL_TRADER_ID = 25;
export const MANUAL_TRADER_NAME = "Kapinza";

export type OrderStatus = "open" | "partially_filled" | "filled" | "cancelled" | "rejected";

/** One row of the orders table, from the database. */
export type StoredOrder = {
  order_id: number;
  trader_id: number;
  trader_name: string;
  side: TradeSide;
  symbol: string;
  quantity: number;
  price_cents: number;
  status: OrderStatus;
  filled: number;
  created_ms: number;
  updated_ms: number;
  reason: string;
};

/** One fill seen from a trader's side, with the name of whoever was on the other side. */
export type TraderFill = {
  trade_id: number;
  symbol: string;
  side: TradeSide;
  price_cents: number;
  quantity: number;
  timestamp_ms: number;
  order_id: number;
  counterparty_id: number;
  counterparty_name: string;
  buy_order_id: number;
  sell_order_id: number;
};

/** Where the reference prices come from: read live from Yahoo (via market-data), saved, or sample. */
export type ReferenceInfo = {
  prices: Record<string, number>; // cents
  source: "yahoo" | "mixed" | "snapshot" | "sample";
  as_of: string; // a date for a snapshot, a time for a live read
  updated_ms: number;
  live: string[];
};

export type OrderBook = { symbol: string; bids: [number, number][]; asks: [number, number][] };

export type ExchangeHealth = { status: string; engine: "connected" | "disconnected"; trades: number };

export class OrderRejected extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

async function exchangeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${EXCHANGE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`exchange-api ${res.status}`);
  return res.json() as Promise<T>;
}

export const getExchangeHealth = () => exchangeFetch<ExchangeHealth>("/health");
export const getTraders = async () => (await exchangeFetch<{ traders: Trader[] }>("/traders")).traders;
export const getDispatch = async () => (await exchangeFetch<{ dispatch?: DispatchInfo }>("/traders")).dispatch;
export const getRecentTrades = async (limit = 50) => (await exchangeFetch<{ trades: LiveTrade[] }>(`/trades?limit=${limit}`)).trades;
export const getOrders = async (traderId: number, limit = 100) =>
  (await exchangeFetch<{ orders: StoredOrder[] }>(`/orders?trader_id=${traderId}&limit=${limit}`)).orders;
export const getFills = async (traderId: number, limit = 100) =>
  (await exchangeFetch<{ fills: TraderFill[] }>(`/traders/${traderId}/fills?limit=${limit}`)).fills;
export async function cancelOrder(orderId: number): Promise<void> {
  const res = await fetch(`${EXCHANGE_URL}/orders/${orderId}`, { method: "DELETE" });
  if (res.status === 409) throw new OrderRejected(((await res.json()) as { detail?: { reason?: string } }).detail?.reason ?? "rejected");
  if (!res.ok) throw new Error(`exchange-api ${res.status}`);
}
export const getReference = () => exchangeFetch<ReferenceInfo>("/reference");
export const getOrderBook = (symbol: string) => exchangeFetch<OrderBook>(`/orderbook?symbol=${encodeURIComponent(symbol)}`);

/** Send a manual order as Kapinza. Throws OrderRejected with the engine's reason, or Error if the API is down. */
export async function postOrder(order: { symbol: string; side: TradeSide; price: number; qty: number }): Promise<number> {
  const res = await fetch(`${EXCHANGE_URL}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trader_id: MANUAL_TRADER_ID, ...order }),
  });
  if (res.status === 409) {
    const body = (await res.json()) as { detail?: { reason?: string } };
    throw new OrderRejected(body.detail?.reason ?? "rejected");
  }
  if (res.status === 429) throw new Error("Too many orders: please wait a second and try again.");
  if (res.status === 422) throw new Error("The order was refused: check shares (1 to 10,000) and price.");
  if (!res.ok) throw new Error(res.status === 503 ? "The matching engine is not reachable." : `exchange-api ${res.status}`);
  return ((await res.json()) as { order_id: number }).order_id;
}

/** Plain-English text for the engine's reject reasons. */
export const REJECT_TEXT: Record<string, string> = {
  max_qty: "The quantity is above the engine limit.",
  price_band: "The price is more than 20% away from the reference price.",
  unknown_symbol: "The engine does not know this symbol.",
  bad_request: "The engine could not read the order.",
  unknown_order: "That order is not on the book.",
  insufficient_cash: "Not enough available cash for this order.",
  insufficient_shares: "Not enough available shares for this order.",
};

/** Keep one WebSocket open (with retry) and hand every parsed JSON message to `onMessage`. Returns a close function. */
function watch(path: string, onMessage: (data: unknown) => void): () => void {
  let socket: WebSocket | null = null;
  let timer: number | undefined;
  let closed = false;
  let attempt = 0;

  const open = () => {
    if (closed) return;
    socket = new WebSocket(`${EXCHANGE_WS}${path}`);
    socket.onopen = () => {
      attempt = 0;
    };
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data as string));
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onclose = () => {
      if (closed) return;
      attempt += 1;
      timer = window.setTimeout(open, Math.min(5000, 1000 * attempt));
    };
    socket.onerror = () => socket?.close();
  };
  open();
  return () => {
    closed = true;
    window.clearTimeout(timer);
    socket?.close();
  };
}

export function watchTrades(onTrade: (trade: LiveTrade) => void, onHistory: (trades: LiveTrade[]) => void): () => void {
  return watch("/ws/trades", (data) => {
    const d = data as { type?: string; trades?: LiveTrade[]; trade_id?: number };
    if (d.type === "history" && Array.isArray(d.trades)) onHistory(d.trades);
    else if (d.trade_id !== undefined) onTrade(d as LiveTrade);
  });
}

export function watchTraders(onUpdate: (traders: Trader[], dispatch?: DispatchInfo) => void): () => void {
  return watch("/ws/traders", (data) => {
    const d = data as { traders?: Trader[]; dispatch?: DispatchInfo };
    if (Array.isArray(d.traders)) onUpdate(d.traders, d.dispatch);
  });
}

/** The reference prices, read again every 10 seconds. `null` until the first answer. */
export function useReference(): ReferenceInfo | null {
  const [info, setInfo] = useState<ReferenceInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => getReference().then((r) => alive && setInfo(r)).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return info;
}

/** The one line that says what the prices in the order book are. */
export function referenceLabel(info: ReferenceInfo | null): string {
  if (!info) return "Reference price: not available (exchange-api is not reachable). Trades: simulated.";
  if (info.source === "yahoo") return "Reference price: Yahoo (delayed up to 15 min). Trades: simulated.";
  if (info.source === "mixed") return `Reference price: Yahoo (delayed up to 15 min) for ${info.live.join(", ")}; the other symbols use a saved snapshot. Trades: simulated.`;
  if (info.source === "snapshot") return `Reference price: saved snapshot from ${info.as_of || "an earlier day"}, because Yahoo could not be read. Trades: simulated.`;
  return "Reference price: sample numbers, no real price was available. Trades: simulated.";
}

/** Live order book for one symbol from /ws/orderbook. `null` until the first snapshot arrives. */
export function useOrderBook(symbol: string): OrderBook | null {
  const [book, setBook] = useState<OrderBook | null>(null);
  useEffect(() => {
    setBook(null);
    return watch(`/ws/orderbook?symbol=${encodeURIComponent(symbol)}`, (data) => {
      const d = data as Partial<OrderBook>;
      if (d.symbol === symbol && Array.isArray(d.bids) && Array.isArray(d.asks)) setBook(d as OrderBook);
    });
  }, [symbol]);
  return book;
}

/** Trading activity for one trader and one symbol, computed by exchange-api from the fills (FIFO lots). */
export type Activity = {
  trader_id: number;
  symbol: string;
  fills: number;
  bought: number;
  sold: number;
  net_position: number;
  avg_buy_cents: number | null;
  avg_sell_cents: number | null;
  realized_pnl_cents: number;
  unrealized_pnl_cents: number | null;
  closed_trades: number;
  win_rate: number | null;
  best_trade_cents: number | null;
  worst_trade_cents: number | null;
  last_price_cents: number | null;
  simulated: boolean;
};
export const getActivity = (traderId: number, symbol: string) =>
  exchangeFetch<Activity>(`/traders/${traderId}/activity?symbol=${encodeURIComponent(symbol)}`);

async function post(path: string, method: string, body: unknown): Promise<Response> {
  const res = await fetch(`${EXCHANGE_URL}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 409) throw new OrderRejected(((await res.json()) as { detail?: { reason?: string } }).detail?.reason ?? "rejected");
  if (!res.ok) throw new Error(`exchange-api ${res.status}`);
  return res;
}

/** Pause, resume or stop one virtual trader. The others keep trading. */
export const controlTrader = (traderId: number, action: ControlAction) => post(`/traders/${traderId}/control`, "POST", { action });
/** Pause, resume or stop one symbol: nobody can place new orders for it until it is resumed. */
export const controlSymbol = (symbol: string, action: ControlAction) => post(`/symbols/${symbol}/control`, "POST", { action });
export const getSymbolStates = async () =>
  (await exchangeFetch<{ symbols: { symbol: string; id: number; state: ControlState }[] }>("/symbols")).symbols;

/** Change a resting order. A lower quantity at the same price keeps its place in the queue; anything else
 *  is a cancel plus a new order (new id, back of the queue). `qty` is the new remaining quantity. */
export async function amendOrder(orderId: number, change: { price?: number; qty?: number }): Promise<{ order_id: number; keeps_priority: boolean }> {
  return (await post(`/orders/${orderId}`, "PATCH", change)).json();
}
