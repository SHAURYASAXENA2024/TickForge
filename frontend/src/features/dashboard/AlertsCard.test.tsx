import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlertsView, newlyFired, type PriceAlert } from "./AlertsCard";

const waiting: PriceAlert = { alert_id: 1, symbol: "AAPL", direction: "above", price_cents: 19550, created_ms: 1, fired_ms: null, fired_price_cents: null };
const fired: PriceAlert = { ...waiting, alert_id: 2, direction: "below", fired_ms: 1_700_000_000_000, fired_price_cents: 19400 };
const noop = () => undefined;
const view = (p: Partial<Parameters<typeof AlertsView>[0]>) =>
  renderToString(<AlertsView alerts={[]} error="" toasts={[]} problem="" symbol="AAPL" direction="above" price="" onSymbol={noop} onDirection={noop} onPrice={noop} onCreate={noop} onDelete={noop} onDismiss={noop} {...p} />);

describe("AlertsCard", () => {
  it("shows an empty state, a loading state and an error", () => {
    expect(view({})).toContain("No alerts yet");
    expect(view({ alerts: null })).toContain("Loading alerts");
    expect(view({ alerts: null, error: "Alerts are not available: exchange-api is not reachable." })).toContain("not reachable");
  });
  it("lists waiting and fired alerts and a toast", () => {
    const html = view({ alerts: [waiting, fired], toasts: [fired] });
    expect(html).toContain("AAPL above $195.50");
    expect(html).toContain("Waiting");
    expect(html).toContain("Fired");
    expect(html).toMatch(/Alert:.*AAPL below/);
    expect(html).not.toContain("undefined");
  });
  it("shows a validation problem", () => {
    expect(view({ problem: "Price must be an amount greater than 0" })).toContain("Price must be");
  });
  it("only a change from waiting to fired makes a toast", () => {
    expect(newlyFired(null, [fired])).toEqual([]);
    expect(newlyFired([waiting], [{ ...waiting, fired_ms: 5, fired_price_cents: 19600 }]).map((a) => a.alert_id)).toEqual([1]);
    expect(newlyFired([fired], [fired])).toEqual([]);
  });
});
