import { describe, expect, it } from "vitest";
import fixture from "./fixtures/journey-max.json";
import { parseJourney } from "./stockApi";

// The fixture is a real response of the market-data journey code for range=max (weekly bars, offline).
describe("range=max", () => {
  it("is parsed with its since-listing block", () => {
    const data = parseJourney(fixture, "TEST", "max");
    expect(data.range).toBe("max");
    expect(data.longTerm?.years.length).toBeGreaterThan(5);
    expect(data.longTerm?.splits).toHaveLength(1);
    expect(data.longTerm?.dividends.count).toBe(1);
  });
  it("is refused when the since-listing block is missing", () => {
    const { longTerm: _omit, ...rest } = fixture as Record<string, unknown>;
    expect(() => parseJourney(rest, "TEST", "max")).toThrow();
  });
});
