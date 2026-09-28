import { expect, it } from "vitest";
import { pence } from "@wealth/domain";
import { budgetGroupTotal, moneyGroupTotal } from "./groupTotals";
it("sums signed cash exactly without presenting missing balances as zero", () => {
  expect(moneyGroupTotal([pence(10001), pence(-2300)], (value) => value)).toBe("£77.01");
  expect(moneyGroupTotal([pence(10001), null], (value) => value)).toBe("—");
});
it("labels homogeneous budget periods and normalises mixed periods", () => {
  expect(
    budgetGroupTotal([
      { amount: "100.10", frequency: "monthly" },
      { amount: "20.20", frequency: "monthly" },
    ]),
  ).toBe("£120.30 / month");
  expect(
    budgetGroupTotal([
      { amount: "1200", frequency: "annual" },
      { amount: "240", frequency: "annual" },
    ]),
  ).toBe("£1,440.00 / year");
  expect(
    budgetGroupTotal([
      { amount: "1200", frequency: "annual" },
      { amount: "250", frequency: "monthly" },
    ]),
  ).toBe("£350.00 / month");
  expect(budgetGroupTotal([{ amount: "invalid", frequency: "monthly" }])).toBe("—");
});
