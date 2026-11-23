import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectionBanner } from "./ConnectionBanner";

describe("ConnectionBanner", () => {
  it("is hidden while everything is reachable", () => {
    expect(renderToString(<ConnectionBanner online engineConnected lastUpdated={new Date()} />)).toBe("");
  });
  it("says the connection is lost, and shows nothing again once it is back", () => {
    const down = renderToString(<ConnectionBanner online={false} engineConnected={false} lastUpdated={null} />);
    expect(down).toMatch(/Connection lost.*No data received yet/);
    expect(renderToString(<ConnectionBanner online engineConnected lastUpdated={new Date()} />)).toBe("");
  });
  it("names the engine when only the engine is down", () => {
    expect(renderToString(<ConnectionBanner online engineConnected={false} lastUpdated={new Date()} />)).toMatch(/matching engine.*Last updated/);
  });
});
