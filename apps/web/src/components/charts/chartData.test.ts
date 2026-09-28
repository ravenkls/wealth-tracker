import { expect, it } from "vitest";
import { month, pence } from "@wealth/domain";
import type { BudgetPlan, Snapshot } from "@wealth/domain";
import { budgetChartData, historyPoints, savingsPoints } from "./chartData";
import type { AppData } from "../../lib/data";
const snapshot = (value: string, total: number): Snapshot => ({
  month: month(value),
  version: 1,
  source: "historical",
  capturedAt: null,
  createdAt: "",
  updatedAt: "",
  balances: [],
  investments: [],
  cash: pence(-100),
  investmentTotal: pence(500),
  pensions: pence(total - 400),
  total: pence(total),
  notes: "",
  periodIncome: null,
  cashPensionContributions: null,
});
const plan: BudgetPlan = {
  salary: pence(300000),
  payFrequency: "monthly",
  sideIncome: pence(0),
  expenses: [
    {
      id: "a",
      name: "Food",
      amount: pence(20000),
      frequency: "monthly",
      destinationId: null,
      category: "Living",
    },
    {
      id: "b",
      name: "Insurance",
      amount: pence(120000),
      frequency: "annual",
      destinationId: null,
      category: "living",
    },
  ],
  savingsAllocations: [
    { id: "c", name: "Holiday", amount: pence(10000), frequency: "monthly", destinationId: null },
  ],
  emergencyMonths: 3,
  targetCashShare: 0.5,
  aggressiveness: 1,
  cashDestinationId: null,
  investmentDestinationId: null,
  cashGoal: null,
  endOfYearGoal: null,
  depositGoal: null,
  depositInvestmentFraction: null,
  depositSavingsFraction: null,
  jobStartMonth: null,
};
it("keeps missing months empty and labels changes across gaps", () => {
  const points = historyPoints(
    [snapshot("2026-05", 1000), snapshot("2026-07", 800)],
    "All",
    month("2026-07"),
  );
  expect(points[0]).toMatchObject({ cash: -100, change: null });
  expect(points[1]).toMatchObject({ label: "2026-06", cash: null, total: null, change: null });
  expect(points[2]).toMatchObject({ change: -200, changeDetail: "May 2026 to July 2026" });
});
it("withholds incomplete savings rather than treating them as zero", () => {
  const points = savingsPoints(
    {
      snapshots: [snapshot("2026-07", 800)],
      currentMonth: month("2026-07"),
      metrics: [{ month: "2026-07", result: { status: "unavailable", reason: "Incomplete" } }],
    } as AppData,
    "All",
  );
  expect(points[0]).toMatchObject({ saved: null, rate: null });
});
it("combines categories case-insensitively using monthly provisions and retains uncategorised items", () => {
  const result = budgetChartData(plan, null);
  expect(result.categories).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Living", value: 30000 }),
      expect.objectContaining({ name: "Uncategorised", value: 10000 }),
    ]),
  );
  expect(result.allocation.reduce((sum, row) => sum + row.value, 0)).toBe(300000);
});
it("shows a signed shortfall while keeping allocation reconciled to income", () => {
  const result = budgetChartData({ ...plan, salary: pence(20000) }, null);
  expect(result.allocation.find((row) => row.id === "deficit")?.value).toBe(-20000);
  expect(result.allocation.reduce((sum, row) => sum + row.value, 0)).toBe(20000);
});
