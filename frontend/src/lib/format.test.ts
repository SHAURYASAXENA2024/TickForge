import { describe, expect, it } from "vitest";
import { dollars, fmtReservedShares, fmtUs, parseCents, signedDollars } from "./format";

describe("fmtReservedShares", () => {
  it("lists the symbols that have shares reserved", () => {
    expect(fmtReservedShares({ AAPL: 1200, TSLA: 5 })).toBe("Reserved for open sell orders: AAPL 1,200, TSLA 5 shares");
  });
  it("says so when nothing is reserved", () => {
    expect(fmtReservedShares({})).toBe("No shares reserved for open sell orders");
    expect(fmtReservedShares({ AAPL: 0 })).toBe("No shares reserved for open sell orders");
  });
});

describe("dollars (integer cents to text)", () => {
  it("formats whole and fractional amounts", () => {
    expect(dollars(18950)).toBe("$189.50");
    expect(dollars(100)).toBe("$1.00");
    expect(dollars(5)).toBe("$0.05");
    expect(dollars(0)).toBe("$0.00");
  });

  it("groups thousands and keeps the sign", () => {
    expect(dollars(123456789)).toBe("$1,234,567.89");
    expect(dollars(-5)).toBe("-$0.05");
    expect(dollars(-250000)).toBe("-$2,500.00");
  });

  it("does not suffer from float rounding", () => {
    expect(dollars(29)).toBe("$0.29"); // 0.29 * 100 is 28.999999999999996 in floating point
    expect(dollars(1005)).toBe("$10.05");
  });

  it("signedDollars adds a plus only for gains", () => {
    expect(signedDollars(1200)).toBe("+$12.00");
    expect(signedDollars(-1200)).toBe("-$12.00");
    expect(signedDollars(0)).toBe("$0.00");
  });
});

describe("parseCents (typed price to cents)", () => {
  it("reads dollars with up to two decimals", () => {
    expect(parseCents("189.50")).toBe(18950);
    expect(parseCents("189.5")).toBe(18950);
    expect(parseCents(" 7 ")).toBe(700);
    expect(parseCents("0.29")).toBe(29);
  });

  it("rejects anything that is not a positive price", () => {
    for (const bad of ["", "abc", "-1", "0", "0.00", "1.234", "1e3", "1,000"]) expect(parseCents(bad)).toBeNull();
  });
});

describe("fmtUs", () => {
  it("picks a readable unit", () => {
    expect(fmtUs(7)).toBe("7.0 µs");
    expect(fmtUs(41)).toBe("41 µs");
    expect(fmtUs(1500)).toBe("1.5 ms");
    expect(fmtUs(2_500_000)).toBe("2.5 s");
  });
});
