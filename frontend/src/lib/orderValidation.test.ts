import { describe, expect, it } from "vitest";
import { orderProblem } from "./orderValidation";

describe("orderProblem", () => {
  it("accepts a normal order and the edges", () => {
    expect(orderProblem("AAPL", "100", "189.50")).toBeNull();
    expect(orderProblem("AAPL", "1", "0.01")).toBeNull();
    expect(orderProblem("AAPL", "10000", "189")).toBeNull();
  });
  it("refuses bad shares", () => {
    for (const q of ["0", "10001", "1.5", "-3", "abc", ""]) expect(orderProblem("AAPL", q, "10")).toMatch(/Shares/);
  });
  it("refuses bad prices", () => {
    expect(orderProblem("AAPL", "1", "10.123")).toMatch(/2 decimals/);
    for (const p of ["0", "0.00", "-1", "x", ""]) expect(orderProblem("AAPL", "1", p)).toMatch(/greater than 0/);
  });
  it("refuses an unknown symbol", () => {
    expect(orderProblem("ZZZZ", "1", "10")).toMatch(/symbol/);
  });
});
