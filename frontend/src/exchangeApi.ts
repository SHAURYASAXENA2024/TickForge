// frontend/src/exchangeApi.ts
// Types + fetch helpers + WebSocket hooks for the TickForge Exchange API (port 8001).

const EXCHANGE_URL = (
  import.meta.env.VITE_EXCHANGE_API_URL || "http://127.0.0.1:8001"
).replace(/\/$/, "");

const EXCHANGE_WS = EXCHANGE_URL.replace(/^http/, "ws");

// ── Types ──────────────────────────────────────────────────────────────────

export type TradeSide = "BUY" | "SELL";

export type LiveTrade = {
  trade_id: number;
  symbol: string;
  price: number;
  quantity: number;
  buyer: string;
  seller: string;
  buyer_id: number;
  seller_id: number;
  timestamp: number;
  buy_order_id: number;
  sell_order_id: number;
};

export type Trader = {
  trader_id: number;
  name: string;
  strategy: string;
  cash: number;
  holdings: Record<string, number>;
  trades_executed: number;
  pnl: number;
  portfolio_value: number;
  last_action: string;
};

export type OrderRequest = {
  symbol: string;
  side: TradeSide;
  price: number;
  quantity: number;
  trader_id?: number;
};

export type ExchangeHealth = {
  status: string;
  engine_connected: boolean;
  trades_in_memory: number;
  db_trade_count: number;
};

// ── REST helpers ───────────────────────────────────────────────────────────

async function exchangeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${EXCHANGE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Exchange API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export async function getExchangeHealth(): Promise<ExchangeHealth> {
  return exchangeFetch<ExchangeHealth>("/health");
}

export async function getRecentTrades(limit = 50): Promise<LiveTrade[]> {
  const data = await exchangeFetch<{ trades: LiveTrade[] }>(`/trades?limit=${limit}`);
  return data.trades;
}

export async function getTraders(): Promise<Trader[]> {
  const data = await exchangeFetch<{ traders: Trader[] }>("/traders");
  return data.traders;
}

export async function postOrder(order: OrderRequest): Promise<{ status: string }> {
  return exchangeFetch<{ status: string }>("/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export async function updatePrice(symbol: string, price: number): Promise<void> {
  await exchangeFetch<void>(`/prices?symbol=${symbol}&price=${price}`, { method: "POST" });
}

// ── WebSocket hooks ────────────────────────────────────────────────────────

/** Connect to /ws/trades and call onTrade for every new executed trade. */
export function connectTradesSocket(
  onTrade: (trade: LiveTrade) => void,
  onHistory?: (trades: LiveTrade[]) => void,
): () => void {
  const ws = new WebSocket(`${EXCHANGE_WS}/ws/trades`);

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data as string);
      if (data && data.type === "history" && Array.isArray(data.trades)) {
        onHistory?.(data.trades as LiveTrade[]);
      } else if (data && data.trade_id !== undefined) {
        onTrade(data as LiveTrade);
      }
    } catch {
      // ignore malformed frames
    }
  };
  ws.onerror = () => {}; // suppress browser console errors when offline

  return () => ws.close();
}

/** Connect to /ws/traders and call onUpdate for every trader state snapshot. */
export function connectTradersSocket(
  onUpdate: (traders: Trader[]) => void,
): () => void {
  const ws = new WebSocket(`${EXCHANGE_WS}/ws/traders`);

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data as string);
      if (Array.isArray(data)) onUpdate(data as Trader[]);
    } catch {
      // ignore
    }
  };
  ws.onerror = () => {};

  return () => ws.close();
}

// ── Symbol list ────────────────────────────────────────────────────────────

export const EXCHANGE_SYMBOLS = [
  "AAPL", "TSLA", "NVDA", "MSFT", "AMZN",
  "GOOGL", "META", "JPM", "BRK-B", "AMD",
] as const;

export type ExchangeSymbol = (typeof EXCHANGE_SYMBOLS)[number];
