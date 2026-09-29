import { expect, it } from "vitest";
import { simulateBudget } from "./budget-simulation";
import { defaultForecastAssumptions } from "./forecast-assumptions";
import { forecastBudget } from "./budget-forecast";
import { budgetFlow } from "./budget-flow";
import { emergencyCoverage } from "./emergency-coverage";
import { calculateBudget } from "./budget";
import type { BudgetPlan, Snapshot } from "./models";
import { pence } from "./money";
import { month } from "./month";

const plan = (patch: Partial<BudgetPlan> = {}): BudgetPlan => ({
  salary: pence(300000),
  payFrequency: "monthly",
  sideIncome: pence(0),
  expenses: [
    {
      id: "rent",
      name: "Rent",
      amount: pence(100000),
      frequency: "monthly",
      destinationId: "bank",
    },
  ],
  savingsAllocations: [
    {
      id: "saving",
      name: "Saving",
      amount: pence(50000),
      frequency: "monthly",
      destinationId: "reserve",
    },
  ],
  emergencyMonths: 3,
  targetCashShare: 0.2,
  aggressiveness: 1,
  cashDestinationId: "reserve",
  investmentDestinationId: "broker",
  cashGoal: null,
  endOfYearGoal: null,
  depositGoal: null,
  depositInvestmentFraction: null,
  depositSavingsFraction: null,
  jobStartMonth: null,
  ...patch,
});
const snapshot = (patch: Partial<Snapshot> = {}): Snapshot => ({
  month: month("2026-09"),
  version: 1,
  source: "current",
  capturedAt: "2026-09-01T12:00:00Z",
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-01T12:00:00Z",
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
it("recalculates the forecast split when reserves cross the emergency threshold, without double counting savings", () => {
  const start = snapshot();
  const result = forecastBudget(plan(), start, 3);
  expect(result.status).toBe("complete");
  if (result.status !== "complete") return;
  expect(result.points.map((point) => [point.month, point.cash, point.investments])).toEqual([
    ["2026-09", 0, 1000000],
    ["2026-10", 200000, 1000000],
    ["2026-11", 400000, 1000000],
    ["2026-12", 468000, 1132000],
  ]);
  expect(result.points.map((point) => point.total)).toEqual([1000000, 1200000, 1400000, 1600000]);
  expect(
    forecastBudget(plan(), snapshot({ pensions: pence(0), total: pence(1000000) }), 3),
  ).toEqual(result);
  expect(start.pensions).toBe(500000);
  expect(start.total).toBe(1500000);
  expect(start.cash).toBe(0);
});
it("leaves rounding in cash and deducts deficits without making savings an extra expense", () => {
  const rounded = forecastBudget(
    plan({
      salary: pence(175099),
      expenses: [],
      savingsAllocations: [],
      emergencyMonths: 0,
      targetCashShare: 0.33,
    }),
    snapshot({ cash: pence(330000), investmentTotal: pence(670000), total: pence(1500000) }),
    1,
  );
  expect(rounded).toMatchObject({
    status: "complete",
    points: [{}, { cash: 388099, investments: 787000, total: 1175099 }],
  });
  const deficit = forecastBudget(
    plan({ salary: pence(50000) }),
    snapshot({ cash: pence(40000), total: pence(1540000) }),
    1,
  );
  expect(deficit).toMatchObject({
    status: "complete",
    points: [{}, { cash: -10000, investments: 1000000, total: 990000 }],
  });
});
it("normalises annual costs and pay frequency and crosses calendar years", () => {
  const annual = forecastBudget(
    plan({
      salary: pence(100000),
      payFrequency: "twice-monthly",
      expenses: [
        {
          id: "annual",
          name: "Annual",
          amount: pence(120000),
          frequency: "annual",
          destinationId: null,
        },
      ],
    }),
    snapshot({ month: month("2026-12") }),
    1,
  );
  expect(annual).toMatchObject({
    status: "complete",
    monthlyChange: 190000,
    points: [{}, { month: "2027-01", total: 1190000 }],
  });
  expect(forecastBudget(plan(), null, 12).status).toBe("unavailable");
  expect(forecastBudget(plan({ targetCashShare: null }), snapshot(), 12).status).toBe(
    "unavailable",
  );
  expect(
    forecastBudget(
      plan({ salary: pence(0), expenses: [], savingsAllocations: [], targetCashShare: null }),
      snapshot(),
      12,
    ).status,
  ).toBe("complete");
  expect(() => forecastBudget(plan(), snapshot(), 61)).toThrow("between 1 and 60");
});
it("shows only selected recorded cash reserves, normalises essential costs, and leaves existing allocation rules unchanged", () => {
  const base = plan();
  const selected = {
    ...base,
    emergencyAccountIds: ["reserve"],
    expenses: [
      { ...base.expenses[0]!, essential: true },
      {
        id: "insurance",
        name: "Insurance",
        amount: pence(120000),
        frequency: "annual" as const,
        essential: true,
        destinationId: null,
      },
      {
        id: "fun",
        name: "Fun",
        amount: pence(100000),
        frequency: "monthly" as const,
        essential: false,
        destinationId: null,
      },
    ],
  };
  const reading = snapshot({
    balances: [
      { accountId: "reserve", name: "Reserve", kind: "cash", balance: pence(220000) },
      { accountId: "other", name: "Other cash", kind: "cash", balance: pence(9900000) },
    ],
  });
  const result = emergencyCoverage(selected, [
    snapshot({ month: month("2026-08"), source: "historical" }),
    reading,
  ]);
  expect(result).toMatchObject({
    monthlyEssentials: 110000,
    targetMonths: 3,
    shortfall: 110000,
    points: [
      { balance: null, months: null },
      { balance: 220000, months: 2 },
    ],
  });
  expect(calculateBudget(selected, reading)).toEqual(
    calculateBudget(
      {
        ...selected,
        emergencyAccountIds: [],
        expenses: selected.expenses.map((line) => ({ ...line, essential: false })),
      },
      reading,
    ),
  );
  expect(
    emergencyCoverage({ ...selected, emergencyAccountIds: ["reserve", "missing"] }, [reading])
      .current?.months,
  ).toBeNull();
  expect(
    emergencyCoverage(selected, [
      snapshot({
        balances: [{ accountId: "reserve", name: "Reserve", kind: "debt", balance: pence(220000) }],
      }),
    ]).current?.months,
  ).toBeNull();
});
it("does not invent coverage for zero costs, missing selections or negative balances", () => {
  expect(emergencyCoverage(plan(), [snapshot()]).configurationReason).toContain("Choose");
  expect(
    emergencyCoverage(plan({ emergencyAccountIds: ["reserve"] }), [snapshot()]).configurationReason,
  ).toContain("Mark expenses");
  const selected = plan({
    emergencyAccountIds: ["reserve", "reserve"],
    expenses: [{ ...plan().expenses[0]!, essential: true }],
  });
  expect(
    emergencyCoverage(selected, [
      snapshot({
        balances: [{ accountId: "reserve", name: "Reserve", kind: "cash", balance: pence(-100) }],
      }),
    ]).current,
  ).toMatchObject({ balance: -100, months: 0 });
});
it.each([
  plan(),
  plan({ salary: pence(50000) }),
  plan({ targetCashShare: null }),
  plan({ salary: pence(0) }),
])(
  "conserves income flow through every category and destination, including a shortfall",
  (budget) => {
    const result = budgetFlow(budget, snapshot(), []);
    const summary = calculateBudget(budget, snapshot());
    expect(result.links.every((link) => link.value > 0)).toBe(true);
    for (const index of result.nodes
      .map((_, index) => index)
      .filter(
        (index) =>
          result.links.some((link) => link.source === index) &&
          result.links.some((link) => link.target === index),
      )) {
      const incoming = result.links
        .filter((link) => link.target === index)
        .reduce((sum, link) => sum + link.value, 0);
      const outgoing = result.links
        .filter((link) => link.source === index)
        .reduce((sum, link) => sum + link.value, 0);
      expect(incoming).toBe(outgoing);
    }
    const shortfall = result.nodes.findIndex((node) => node.kind === "shortfall");
    expect(
      result.links
        .filter((link) => link.source === shortfall)
        .reduce((sum, link) => sum + link.value, 0),
    ).toBe(Math.max(0, -summary.surplus));
  },
);
it("omits zero-value flow nodes and combines categories without colliding with account names", () => {
  expect(
    budgetFlow(plan({ salary: pence(0), expenses: [], savingsAllocations: [] }), null, []),
  ).toEqual({ nodes: [], links: [] });
  const budget = plan({
    expenses: [
      { ...plan().expenses[0]!, category: "Home" },
      { ...plan().expenses[0]!, id: "second", category: "home" },
    ],
  });
  const flow = budgetFlow(budget, snapshot(), [{ id: "bank", name: "Home" }]);
  expect(flow.nodes.filter((node) => node.kind === "expense")).toHaveLength(1);
  expect(flow.nodes.filter((node) => node.name === "Home")).toHaveLength(2);
});

it("routes planned investments and pensions out of cash and excludes pension saving from accessible growth and savings rates", () => {
  const input = plan({
    forecastAssumptions: { ...defaultForecastAssumptions, annualGrowth: 0, annualVolatility: 0 },
    savingsAllocations: [
      {
        id: "invest",
        name: "Fund",
        amount: pence(30000),
        frequency: "monthly",
        destinationId: "manual-investment",
      },
      {
        id: "broker",
        name: "ISA",
        amount: pence(20000),
        frequency: "monthly",
        destinationId: "broker",
      },
      {
        id: "pension",
        name: "Pension",
        amount: pence(120000),
        frequency: "annual",
        destinationId: "pension",
      },
      { id: "cash", name: "Cash", amount: pence(40000), frequency: "monthly", destinationId: null },
    ],
  });
  const targets = [
    { id: "manual-investment", kind: "investment" as const },
    { id: "broker", kind: "investment" as const },
    { id: "pension", kind: "pension" as const },
  ];
  const start = snapshot();
  const summary = calculateBudget(input, start, targets);
  expect(summary).toMatchObject({
    explicitSavings: 100000,
    investmentSavings: 50000,
    pensionSavings: 10000,
    surplus: 100000,
  });
  expect(summary.plannedSavingsRate).toBeCloseTo(190000 / 300000);
  expect(summary.funding).toContainEqual({
    destinationId: "pension",
    monthly: 10000,
    perPayPeriod: 10000,
  });
  const forecast = forecastBudget(input, start, 12, targets);
  if (forecast.status !== "complete") throw new Error(forecast.reason);
  expect(forecast.monthlyChange).toBe(190000);
  expect(forecast.points[1]).toMatchObject({ cash: 140000, investments: 1050000, total: 1190000 });
  const simulated = simulateBudget(input, start, 12, { paths: 20, destinations: targets });
  if (simulated.status !== "complete") throw new Error(simulated.reason);
  for (const [index, point] of forecast.points.entries())
    for (const metric of ["cash", "investments", "total"] as const)
      expect(simulated.points[index]![metric]).toEqual({
        low: point[metric],
        median: point[metric],
        high: point[metric],
      });
});

it("retains planned investment contributions in a deficit and falls back to recorded destination kinds", () => {
  const input = plan({
    salary: pence(50000),
    savingsAllocations: [
      {
        id: "invest",
        name: "ISA",
        amount: pence(20000),
        frequency: "monthly",
        destinationId: "broker",
      },
      {
        id: "pension",
        name: "Pension",
        amount: pence(10000),
        frequency: "monthly",
        destinationId: "pension",
      },
    ],
  });
  const start = snapshot({
    balances: [{ accountId: "pension", name: "Pension", kind: "pension", balance: pence(500000) }],
    investments: [
      {
        connectionId: "broker",
        name: "ISA",
        accountType: "isa",
        total: pence(1000000),
        cash: pence(0),
        fetchedAt: "2026-09-01T00:00:00Z",
        positions: [],
      },
    ],
  });
  const forecast = forecastBudget(input, start, 1);
  expect(forecast).toMatchObject({
    status: "complete",
    points: [{}, { cash: -80000, investments: 1020000, total: 940000 }],
  });
  expect(calculateBudget(input, start).pensionSavings).toBe(10000);
  // Current account metadata takes precedence over an older saved classification.
  expect(calculateBudget(input, start, [{ id: "pension", kind: "cash" }]).pensionSavings).toBe(0);
});
