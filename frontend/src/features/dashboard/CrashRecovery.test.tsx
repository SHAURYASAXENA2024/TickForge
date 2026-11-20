// The Crash recovery panel in each state: demo off, API error, PASS and FAIL.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CRASH_NOTE, DEMO_OFF_MESSAGE, RecoveryView, buildRows, stepIndex, type DemoResult, type RecoveryStatus } from "./CrashRecovery";

const status = (over: Partial<RecoveryStatus> = {}): RecoveryStatus => ({
  engine: { wal_bytes: 20480, frames_written: 321, last_sequence: 321, state_hash: "0123456789abcdef", crc_errors: 0,
    last_recovery: { frames_replayed: 0, duration_ms: 0.4, recovered_at: 1 } },
  engine_error: "",
  supervisor: { supervised: true, restart_on_crash: true, engine_alive: true, restarts: 2 },
  demo_enabled: true,
  demo: { running: false, phase: "idle", last: null },
  ...over,
});

const noop = () => {};
const view = (props: Partial<Parameters<typeof RecoveryView>[0]>) =>
  renderToString(<RecoveryView status={status()} error="" result={null} busy={false} confirming={false} onAsk={noop} onConfirm={noop} onCancel={noop} {...props} />);

const fields = (hashMatch: boolean) => ({
  last_sequence: { before: 321, after: 321, match: true },
  state_hash: { before: "0123456789abcdef", after: hashMatch ? "0123456789abcdef" : "ffffffffffffffff", match: hashMatch },
  "books.AAPL.bids": { before: [[100, 1]], after: [[100, 1]], match: true },
  "cash.Kapinza.cash": { before: 5, after: 5, match: true },
  "cash.trader_1.cash": { before: 5, after: 5, match: true },
});

describe("Crash recovery panel", () => {
  it("shows live stats, the timeline and the power loss line", () => {
    const html = view({});
    for (const text of ["WAL size", "20.0 KB", "321", "01234567", "CRC errors", "Restarts", "Running", "Killed", "Replaying", "Recovered", CRASH_NOTE]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('title="0123456789abcdef"'); // full hash on hover
    expect(html).not.toContain(DEMO_OFF_MESSAGE);
    expect(html).not.toMatch(/Crash engine<\/button>.*disabled/);
  });

  it("disables the button and says why when the demo is off", () => {
    const html = view({ status: status({ demo_enabled: false }) });
    expect(html).toContain(DEMO_OFF_MESSAGE);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Crash engine/);
  });

  it("asks twice before crashing", () => {
    const html = view({ confirming: true });
    expect(html).toContain("Confirm crash");
    expect(html).toContain("Cancel");
  });

  it("shows a readable error instead of a blank panel when the API fails", () => {
    const html = view({ status: null, error: "exchange-api answered 500" });
    expect(html).toContain("Could not read the recovery status");
    expect(html).toContain("exchange-api answered 500");
    expect(html).toContain(CRASH_NOTE);
  });

  it("shows PASS with matches and the replay line", () => {
    const result: DemoResult = { result: "PASS", differing: [], fields: fields(true), frames_replayed: 321, duration_ms: 3.6 };
    const html = view({ result });
    expect(html).toContain("PASS");
    expect(html).toContain("Replayed 321 frames in 4 ms");
    expect(html).toContain("✓ match");
    expect(html).not.toContain("✗ mismatch");
  });

  it("shows FAIL and names the mismatching row", () => {
    const result: DemoResult = { result: "FAIL", differing: ["state_hash"], fields: fields(false), frames_replayed: 321, duration_ms: 3 };
    const html = view({ result });
    expect(html).toContain("FAIL");
    expect(html).toContain("✗ mismatch");
    expect(html).toContain("Differs: state_hash");
  });

  it("maps phases to timeline steps and groups rows", () => {
    expect(stepIndex("quiescing", false)).toBe(0);
    expect(stepIndex("killed", false)).toBe(1);
    expect(stepIndex("snapshot_after", false)).toBe(2);
    expect(stepIndex("done", true)).toBe(3);
    const rows = buildRows(fields(true));
    expect(rows.map((r) => r.label)).toEqual(expect.arrayContaining(["book, top 5 levels, AAPL", "cash and reserved cash, Kapinza", "cash and reserved cash, 1 virtual traders"]));
  });
});
