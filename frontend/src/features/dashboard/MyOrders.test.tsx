import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MyOrders, OrdersPanel, fetchTraderData, latestKey, traderOptions } from "./MyOrders";
import type { StoredOrder, Trader, TraderFill } from "@/lib/exchangeApi";

const trader = (id: number, name: string) => ({ trader_id: id, name }) as Trader;
const traders = [trader(2, "Zed"), trader(1, "Ada"), trader(25, "Kapinza")];
const order: StoredOrder = { order_id: 7, trader_id: 1, trader_name: "Ada", side: "BUY", symbol: "AAPL", quantity: 100, price_cents: 19000, status: "open", filled: 40, created_ms: 1, updated_ms: 1, reason: "" };
const fill = (side: "BUY" | "SELL"): TraderFill => ({ trade_id: 1, symbol: "AAPL", side, price_cents: 19000, quantity: 40, timestamp_ms: 1_700_000_000_000, order_id: 7, counterparty_id: 2, counterparty_name: "Zed", buy_order_id: 7, sell_order_id: 8 });
const noop = () => undefined;
const panel = (p: Partial<Parameters<typeof OrdersPanel>[0]>) =>
  renderToString(
    <OrdersPanel name="Ada" readOnly traderId={1} options={traderOptions(traders)} data={{ orders: [order], fills: [] }} failed={false} online note={null} editing={null}
      onSelect={noop} onEdit={noop} onApply={noop} onCancel={noop} {...p} />,
  );

describe("MyOrders trader view", () => {
  it("defaults to Kapinza, listed first, then the virtual traders by name", () => {
    expect(traderOptions(traders).map((o) => o.name)).toEqual(["Kapinza", "Ada", "Zed"]);
    const html = renderToString(<MyOrders online />);
    expect(html).toContain("My orders (Kapinza)");
    expect(html).toContain("Loading orders");
  });
  it("fetches orders and fills of the chosen trader id", async () => {
    const api = { getOrders: vi.fn(async () => [order]), getFills: vi.fn(async () => [fill("BUY")]) };
    const d = await fetchTraderData(2, api);
    expect(api.getOrders).toHaveBeenCalledWith(2);
    expect(api.getFills).toHaveBeenCalledWith(2);
    expect(d.orders).toHaveLength(1);
  });
  it("is read only for a virtual trader and keeps Amend and Cancel for Kapinza", () => {
    const ro = panel({});
    expect(ro).toContain("My orders (Ada)");
    expect(ro).not.toContain("Cancel");
    expect(ro).not.toContain("Amend");
    expect(ro).toMatch(/Buy/);
    expect(ro).toContain("40"); // filled
    const own = panel({ name: "Kapinza", readOnly: false, traderId: 25 });
    expect(own).toContain("Cancel");
    expect(own).toContain("Amend");
  });
  it("names the counterparty: a buy shows the seller, a sell shows the buyer", () => {
    expect(panel({ data: { orders: [order], fills: [fill("BUY")] } })).toContain("Sold by ");
    expect(panel({ data: { orders: [order], fills: [fill("SELL")] } })).toContain("Bought by ");
    expect(panel({ data: { orders: [order], fills: [fill("BUY")] } })).toContain("Zed");
  });
  it("shows an empty state and an error state", () => {
    expect(panel({ data: { orders: [], fills: [] } })).toContain("Ada has no orders yet");
    const bad = panel({ data: null, failed: true });
    expect(bad).toContain("Orders are not available");
    expect(bad).toContain("Ada");
    expect(panel({ data: null })).toContain("Loading orders");
  });
  it("ignores a late answer for the trader that was selected before", async () => {
    const guard = latestKey<number>();
    const applied: number[] = [];
    let release!: (v: number) => void;
    const slow = new Promise<number>((r) => (release = r));
    guard.set(1);
    const first = slow.then((v) => guard.isCurrent(1) && applied.push(v));
    guard.set(2); // the person switched trader
    release(111);
    await first;
    expect(applied).toEqual([]);
    expect(guard.isCurrent(2)).toBe(true);
  });
});
