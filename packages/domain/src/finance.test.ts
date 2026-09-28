import { describe, expect, it } from "vitest";
import {
  calculateNetWorth,
  formatGbp,
  formatMonth,
  month,
  parseGbp,
  pence,
  sumMoney,
} from "./index";

describe("GBP amounts", () => {
  it("preserves pennies when formatting the full supported range", () => {
    expect(formatGbp(pence(Number.MAX_SAFE_INTEGER))).toBe("£90,071,992,547,409.91");
    expect(formatGbp(pence(-1))).toBe("-£0.01");
    expect(formatGbp(pence(0))).toBe("£0.00");
  });
  it("parses decimals and negative debt without floating point arithmetic", () => {
    expect(sumMoney([parseGbp("0.10"), parseGbp("0.20")])).toBe(30);
    expect(parseGbp("-200.01")).toBe(-20001);
    expect(parseGbp(" 12.5 ")).toBe(1250);
    expect(Object.is(parseGbp("-0.00"), -0)).toBe(false);
  });
  it.each(["1.001", "1e3", "NaN", "Infinity", "", "1,000", "90071992547409.92"])(
    "rejects invalid or unsafe amount %s",
    (value) => {
      expect(() => parseGbp(value)).toThrow(/GBP amount|safe integer/);
    },
  );
  it("rejects total overflow rather than rounding", () => {
    expect(() => sumMoney([pence(Number.MAX_SAFE_INTEGER), pence(1)])).toThrow("safe integer");
  });
});

describe("net worth", () => {
  it("subtracts debt and counts each complete investment account once", () => {
    const result = calculateNetWorth({
      cash: [parseGbp("1000"), parseGbp("-200")],
      investments: [parseGbp("3000")],
      pensions: [parseGbp("5000")],
    });
    expect(result.total).toBe(880000);
    expect(result.excludingPensions).toBe(380000);
  });
  it("does not change when cash transfers to the brokerage account", () => {
    const before = calculateNetWorth({
      cash: [parseGbp("1000")],
      investments: [parseGbp("3000")],
      pensions: [],
    });
    const after = calculateNetWorth({
      cash: [parseGbp("500")],
      investments: [parseGbp("3500")],
      pensions: [],
    });
    expect(before.total).toBe(after.total);
  });
});

describe("calendar month identity", () => {
  it("stores a month without a timezone-dependent timestamp", () => {
    expect(month("2026-09")).toBe("2026-09");
    expect(formatMonth(month("2026-09"))).toBe("September 2026");
    expect([month("2027-01"), month("2026-12")].sort()).toEqual(["2026-12", "2027-01"]);
  });
  it.each(["2026-9", "2026-00", "2026-13", "0000-01", "2026-09-28", "2026-09T00:00:00Z"])(
    "rejects %s",
    (value) => {
      expect(() => month(value)).toThrow("YYYY-MM");
    },
  );
});
