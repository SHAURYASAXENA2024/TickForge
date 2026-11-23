import { EXCHANGE_SYMBOLS } from "./exchangeApi";
import { parseCents } from "./format";

export const MAX_SHARES = 10_000;

/** A readable problem with the manual order form, or null when it can be sent. */
export function orderProblem(symbol: string, qty: string, price: string): string | null {
  if (!(EXCHANGE_SYMBOLS as readonly string[]).includes(symbol)) return "Choose a symbol from the list.";
  if (!/^\s*\d+\s*$/.test(qty) || Number(qty) < 1 || Number(qty) > MAX_SHARES)
    return `Shares must be a whole number from 1 to ${MAX_SHARES.toLocaleString("en-US")}.`;
  if (/^\s*\d*\.\d{3,}\s*$/.test(price)) return "Price can have at most 2 decimals, like 189.50.";
  if (parseCents(price) === null) return "Price must be an amount greater than 0, like 189.50.";
  return null;
}
