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

/** network = API unreachable, http = API answered with an error, contract = unexpected payload */
export class StockApiError extends Error {
  kind: "network" | "http" | "contract";
  constructor(kind: "network" | "http" | "contract", message: string) {
    super(message);
    this.kind = kind;
  }
}

const API_URL = (import.meta.env.VITE_STOCK_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export async function getStockSnapshot(
  symbol: string,
  signal?: AbortSignal,
): Promise<StockSnapshot> {
  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/api/stocks/${encodeURIComponent(symbol)}?range=1d&interval=5m`,
      { signal },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new StockApiError("network", "Unable to reach the stock API");
  }

  if (!response.ok) {
    let detail = `Stock API returned ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && typeof (body as { detail?: unknown }).detail === "string") {
        detail = (body as { detail: string }).detail;
      }
    } catch {
      /* keep the generic message */
    }
    throw new StockApiError("http", detail);
  }

  const data: unknown = await response.json();

  if (!data || typeof data !== "object") {
    throw new StockApiError("contract", "Stock API returned invalid JSON");
  }
  const errorField = (data as { error?: unknown }).error;
  if (typeof errorField === "string") {
    throw new StockApiError("http", errorField);
  }

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
    throw new StockApiError("contract", "Stock API response does not match the TickForge contract");
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
    throw new StockApiError("contract", "Stock API returned no valid OHLCV history");
  }

  return { ...snapshot, history } as StockSnapshot;
}
