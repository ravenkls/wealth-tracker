import { describe, expect, it } from "vitest";
import {
  annualProvision,
  dynamicCashShare,
  emergencyTarget,
  monthlyPay,
  roundedAllocation,
} from "./budget-rules";
import { pence } from "./money";

describe("spreadsheet-derived rules", () => {
  it("uses the source pay-frequency factors", () => {
    expect(monthlyPay(pence(10000), "twice-monthly")).toBe(20000);
    expect(monthlyPay(pence(10000), "weekly")).toBe(43452);
    expect(monthlyPay(pence(10000), "fortnightly")).toBe(21726);
    expect(monthlyPay(pence(10000), "four-weekly")).toBe(10833);
    expect(annualProvision(pence(12000))).toBe(1000);
  });
  it("rounds emergency cover up to a thousand pounds", () => {
    expect(emergencyTarget(pence(245000), 3)).toBe(800000);
  });
  it("forces cash allocation below the emergency threshold", () => {
    expect(
      dynamicCashShare({
        target: 0.2,
        recordedCash: pence(500000),
        recordedInvestments: pence(5000000),
        aggressiveness: 2,
        emergency: pence(800000),
      }),
    ).toBe(1);
  });
  it("applies the source dynamic adjustment and clamps the share", () => {
    expect(
      dynamicCashShare({
        target: 0.3,
        recordedCash: pence(20000),
        recordedInvestments: pence(80000),
        aggressiveness: 2,
        emergency: pence(0),
      }),
    ).toBe(0.5);
    expect(
      dynamicCashShare({
        target: 0.1,
        recordedCash: pence(90000),
        recordedInvestments: pence(10000),
        aggressiveness: 3,
        emergency: pence(0),
      }),
    ).toBe(0);
  });
  it("rounds the shares independently to ten pounds without assigning the remainder", () => {
    expect(roundedAllocation(pence(175099), 0.33)).toBe(57000);
    expect(roundedAllocation(pence(175099), 0.67)).toBe(117000);
  });
});
