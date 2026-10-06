export type PricePoint = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StockSnapshot = {
  symbol: string;
  currency: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  marketState: string;
  updatedAt: string;
  history: PricePoint[];
};

const API_URL = (import.meta.env.VITE_STOCK_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export async function getStockSnapshot(
  symbol: string,
  signal?: AbortSignal,
): Promise<StockSnapshot> {
  const response = await fetch(
    `${API_URL}/api/stocks/${encodeURIComponent(symbol)}?range=1d&interval=5m`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(`Stock API returned ${response.status}`);
  }

  const data: unknown = await response.json();

  console.log("STOCK API RESPONSE:", data);
  
  if (!data || typeof data !== "object") throw new Error("Stock API returned invalid JSON");
  

  const snapshot = data as Partial<StockSnapshot>;
  if (
    typeof snapshot.symbol !== "string" ||
    typeof snapshot.currency !== "string" ||
    !isNumber(snapshot.price) ||
    !isNumber(snapshot.previousClose) ||
    !isNumber(snapshot.change) ||
    !isNumber(snapshot.changePercent) ||
    !isNumber(snapshot.volume) ||
    typeof snapshot.marketState !== "string" ||
    typeof snapshot.updatedAt !== "string" ||
    !Array.isArray(snapshot.history)
  ) {
    throw new Error("Stock API response does not match the TickForge contract");
  }

  const history = snapshot.history.filter(
    (point): point is PricePoint =>
      !!point &&
      typeof point.timestamp === "string" &&
      isNumber(point.open) &&
      isNumber(point.high) &&
      isNumber(point.low) &&
      isNumber(point.close) &&
      isNumber(point.volume),
  );

  if (history.length === 0) {
    throw new Error("Stock API returned no valid OHLCV history");
  }

  return { ...snapshot, history } as StockSnapshot;
}
