import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplayView, type ReplayResult } from "./ReplayScrubber";

const result: ReplayResult = { symbol: "AAPL", seq: 40, newest_seq: 120, trades: 3, state_hash: "552cd1876c107a07", bids: [[18500, 20]], asks: [] };
const noop = () => undefined;
const view = (p: Partial<Parameters<typeof ReplayView>[0]>) =>
  renderToString(<ReplayView result={result} error="" loading={false} seq={40} symbol="AAPL" onSeq={noop} onSymbol={noop} {...p} />);

describe("ReplayView", () => {
  it("shows the slider, hash, trade count and levels", () => {
    const html = view({});
    expect(html).toContain('max="120"');
    expect(html).toContain("552cd1876c107a07");
    expect(html).toContain("$185.00");
    expect(html).toContain("none");
    expect(html).not.toContain("undefined");
  });
  it("shows loading and a readable error", () => {
    expect(view({ result: null, seq: null })).toContain("Reading the log");
    expect(view({ result: null, error: "the wal_replay tool is not built (run ./build.sh)" })).toContain("not built");
  });
});
