import { expect, it } from "vitest";
import { forecastBudget } from "./budget-forecast";
import { simulateBudget } from "./budget-simulation";
import { defaultForecastAssumptions } from "./forecast-assumptions";
import { month } from "./month";
import { pence } from "./money";
import type { BudgetPlan, ForecastAssumptions, Snapshot } from "./models";

const plan = (assumptions: Partial<ForecastAssumptions> = {}): BudgetPlan => ({
  salary: pence(300000),
  payFrequency: "monthly",
  sideIncome: pence(0),
  expenses: [
    { id: "rent", name: "Rent", amount: pence(100000), frequency: "monthly", destinationId: null },
  ],
  savingsAllocations: [
    {
      id: "saving",
      name: "Saving",
      amount: pence(50000),
      frequency: "monthly",
      destinationId: null,
    },
  ],
  emergencyMonths: 3,
  targetCashShare: 0.2,
  aggressiveness: 1,
  cashDestinationId: null,
  investmentDestinationId: null,
  cashGoal: null,
  endOfYearGoal: null,
  depositGoal: null,
  depositInvestmentFraction: null,
  depositSavingsFraction: null,
  jobStartMonth: null,
  forecastAssumptions: {
    ...defaultForecastAssumptions,
    annualGrowth: 0,
    annualVolatility: 0,
    ...assumptions,
  },
});
const snapshot = (patch: Partial<Snapshot> = {}): Snapshot => ({
  month: month("2026-09"),
  version: 1,
  source: "current",
  capturedAt: "2026-09-01T00:00:00Z",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  balances: [],
  investments: [],
  cash: pence(0),
  investmentTotal: pence(1000000),
  pensions: pence(500000),
  total: pence(1500000),
  notes: "",
  periodIncome: null,
  cashPensionContributions: null,
  ...patch,
});
const simulate = (input = plan(), start = snapshot(), months = 12, paths = 100) => {
  const result = simulateBudget(input, start, months, { paths });
  if (result.status !== "complete") throw new Error(result.reason);
  return result;
};
it("collapses to the exact budget forecast without uncertainty or growth, including emergency rebalancing", () => {
  const input = plan();
  const start = snapshot();
  const baseline = forecastBudget(input, start, 24);
  if (baseline.status !== "complete") throw new Error(baseline.reason);
  const result = simulate(input, start, 24);
  for (const [index, point] of baseline.points.entries())
    for (const metric of ["cash", "investments", "total"] as const)
      expect(result.points[index]![metric]).toEqual({
        low: point[metric],
        median: point[metric],
        high: point[metric],
      });
  expect(simulate(input, snapshot({ pensions: pence(0), total: pence(1000000) }), 24)).toEqual(
    result,
  );
  expect(start.total).toBe(1500000);
});
it("keeps recorded brokerage cash out of returns and adds new investments after monthly growth", () => {
  const input = {
    ...plan({ annualGrowth: 1.01 ** 12 - 1 }),
    salary: pence(100000),
    expenses: [],
    savingsAllocations: [],
    emergencyMonths: 0,
    targetCashShare: 0,
  };
  const start = snapshot({
    cash: pence(100000),
    investmentTotal: pence(1000000),
    investments: [
      {
        connectionId: "broker",
        name: "ISA",
        accountType: "isa",
        total: pence(1000000),
        cash: pence(400000),
        positions: [],
        fetchedAt: "2026-09-01T00:00:00Z",
      },
    ],
  });
  const result = simulate(input, start, 2);
  expect(result.brokerageCash).toBe(400000);
  expect(result.hasUnknownCash).toBe(false);
  expect(result.points[1]!.investments.median).toBe(1106000);
  expect(result.points[2]!.investments.median).toBe(1213060);
  const cashOnly = simulate(
    {
      ...input,
      salary: pence(0),
      forecastAssumptions: { ...defaultForecastAssumptions, annualVolatility: 1 },
    },
    {
      ...start,
      investmentTotal: pence(400000),
      investments: [{ ...start.investments[0]!, total: pence(400000) }],
    },
  );
  expect(cashOnly.points.at(-1)!.investments).toEqual({
    low: 400000,
    median: 400000,
    high: 400000,
  });
});
it("deducts overspending, permits negative cash, and never turns underspending into negative expenses", () => {
  const overspend = simulate(
    plan({ spendingLow: pence(400000), spendingUsual: pence(400000), spendingHigh: pence(400000) }),
    snapshot(),
    1,
  );
  expect(overspend.points[1]!.cash.median).toBe(-200000);
  expect(overspend.points[1]!.investments.median).toBe(1000000);
  const underspend = simulate(
    plan({
      spendingLow: pence(-200000),
      spendingUsual: pence(-200000),
      spendingHigh: pence(-200000),
    }),
    snapshot(),
    1,
  );
  expect(underspend.points[1]!.total.median).toBe(1300000);
});
it("samples the bounded spending distribution rather than treating usual as the mean", () => {
  const input = {
    ...plan({ spendingLow: pence(0), spendingUsual: pence(0), spendingHigh: pence(150000) }),
    targetCashShare: 1,
  };
  const result = simulate(input, snapshot(), 1, 4000);
  // The triangular distribution with its mode at zero has median max * (1 - sqrt(0.5)).
  expect(result.points[1]!.cash.median).toBeCloseTo(200000 - 150000 * (1 - Math.sqrt(0.5)), -4);
  expect(result.points[1]!.cash.low).toBeGreaterThanOrEqual(50000);
  expect(result.points[1]!.cash.high).toBeLessThanOrEqual(200000);
});
it("is reproducible, preserves prefixes across horizons, and orders all percentile bands", () => {
  const input = plan({ annualGrowth: 0.05, annualVolatility: 0.18, spendingHigh: pence(50000) });
  const first = simulate(input, snapshot(), 12);
  expect(simulate(input, snapshot(), 12)).toEqual(first);
  expect(simulate(input, snapshot(), 24).points.slice(0, 13)).toEqual(first.points);
  expect(first.hasUnknownCash).toBe(true);
  for (const point of first.points)
    for (const metric of ["cash", "investments", "total"] as const) {
      expect(point[metric].low).toBeLessThanOrEqual(point[metric].median);
      expect(point[metric].median).toBeLessThanOrEqual(point[metric].high);
    }
  expect(first.points.at(-1)!.total.high).toBeGreaterThan(first.points.at(-1)!.total.low);
});
it("interprets annual growth as compound growth with independent positive market factors", () => {
  const input = {
    ...plan({ annualGrowth: 0.05, annualVolatility: 0.18 }),
    salary: pence(0),
    expenses: [],
    savingsAllocations: [],
  };
  const initial = snapshot({ investmentTotal: pence(100000000) });
  const growing = simulate(input, initial);
  const flat = simulate(
    { ...input, forecastAssumptions: { ...input.forecastAssumptions!, annualGrowth: 0 } },
    initial,
  );
  expect(
    growing.points.at(-1)!.investments.median / flat.points.at(-1)!.investments.median,
  ).toBeCloseTo(1.05, 5);
  expect(growing.points.at(-1)!.investments.low).toBeGreaterThanOrEqual(0);
});
it("rejects invalid assumptions, missing allocation settings and inconsistent brokerage values", () => {
  expect(() => simulate(plan({ spendingLow: pence(1) }))).toThrow("ordered");
  expect(() => simulate(plan({ annualGrowth: -1 }))).toThrow("growth");
  expect(() => simulate(plan({ annualVolatility: NaN }))).toThrow("volatility");
  expect(simulateBudget(plan(), null, 12).status).toBe("unavailable");
  expect(simulateBudget({ ...plan(), targetCashShare: null }, snapshot(), 12).status).toBe(
    "unavailable",
  );
  expect(simulateBudget(plan(), snapshot({ investmentTotal: pence(-1) }), 12).status).toBe(
    "unavailable",
  );
  expect(() => simulateBudget(plan(), snapshot(), 12, { paths: 0 })).toThrow("paths");
});
