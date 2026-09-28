import { expect, it } from "vitest";
import { month } from "./month";
import { pence } from "./money";
import { inferSavings } from "./savings";
import { projectSavings } from "./projections";
import type { Snapshot, CashEvent, BudgetPlan } from "./models";
const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  month: month("2026-08"),
  version: 1,
  source: "current",
  capturedAt: "2026-08-01T12:00:00Z",
  createdAt: "2026-08-01T12:00:00Z",
  updatedAt: "2026-08-01T12:00:00Z",
  balances: [],
  investments: [
    {
      connectionId: "t212",
      name: "Invest",
      accountType: "invest",
      total: pence(100000),
      cash: pence(0),
      fetchedAt: "2026-08-01T12:00:00Z",
      positions: [],
    },
  ],
  cash: pence(100000),
  investmentTotal: pence(100000),
  pensions: pence(100000),
  total: pence(300000),
  notes: "",
  periodIncome: pence(300000),
  cashPensionContributions: pence(0),
  ...overrides,
});
const current = (overrides: Partial<Snapshot> = {}) =>
  snapshot({ month: month("2026-09"), capturedAt: "2026-09-01T12:00:00Z", ...overrides });
const event = (
  type: string,
  amount: number,
  source: "transaction" | "dividend" = "transaction",
): CashEvent => ({
  reference: type,
  type,
  amount: pence(amount),
  source,
  occurredAt: "2026-08-15T12:00:00Z",
});
it("does not count transfers into investments or market and pension growth as newly saved income", () => {
  const result = inferSavings(
    snapshot(),
    current({ cash: pence(50000), investmentTotal: pence(220000), pensions: pence(200000) }),
    [event("DEPOSIT", 50000)],
    true,
  );
  expect(result).toMatchObject({ status: "complete", saved: 0, spending: 300000, rate: 0 });
});
it("excludes pension payments from spending and savings rate while including cash income and fees", () => {
  const result = inferSavings(
    snapshot(),
    current({ cash: pence(250000), cashPensionContributions: pence(50000) }),
    [
      event("ORDINARY", 1000, "dividend"),
      event("INTEREST_ON_FREE_CASH", 200),
      event("FEE", 100),
      event("RETURN_OF_CAPITAL", 5000, "dividend"),
    ],
    true,
  );
  expect(result).toMatchObject({
    status: "complete",
    saved: 151100,
    income: 301200,
    spending: 100100,
  });
});
it("withholds estimates for ambiguous transfers, missing inputs and incomplete history", () => {
  expect(inferSavings(snapshot(), current(), [event("TRANSFER", 100)], true).status).toBe(
    "unavailable",
  );
  expect(inferSavings(snapshot(), current(), [], false).status).toBe("unavailable");
  expect(inferSavings(snapshot(), current({ periodIncome: null }), [], true).status).toBe(
    "unavailable",
  );
  expect(inferSavings(snapshot({ capturedAt: null }), current(), [], true).status).toBe(
    "unavailable",
  );
  expect(inferSavings(snapshot(), current({ investments: [] }), [], true).status).toBe(
    "unavailable",
  );
});
it("uses an exclusive start and inclusive end and allows zero income without a rate", () => {
  const previous = snapshot();
  const next = current({ periodIncome: pence(0) });
  const result = inferSavings(
    previous,
    next,
    [
      { ...event("DEPOSIT", 100), occurredAt: previous.capturedAt! },
      { ...event("DEPOSIT", 200), occurredAt: next.capturedAt! },
    ],
    true,
  );
  expect(result).toMatchObject({ status: "complete", saved: 200, rate: null });
});
it("normalises irregular saving intervals by elapsed days rather than observation count", () => {
  const previous = snapshot({ capturedAt: "2026-07-01T12:00:00Z", month: month("2026-07") });
  const next = current({ cash: pence(161000) });
  const metrics = [{ month: next.month, result: inferSavings(previous, next, [], true) }];
  const projected = projectSavings(null, [previous, next], metrics, "2026-09");
  expect(projected?.coveredDays).toBe(62);
  expect(projected?.monthlySaved).toBe(29946);
  expect(projected?.eligibleIntervals).toBe(1);
});
it("reserves emergency cash and uses explicitly configured deposit fractions", () => {
  const previous = snapshot(),
    next = current({ cash: pence(200000) });
  const plan: BudgetPlan = {
    salary: pence(300000),
    payFrequency: "monthly",
    sideIncome: pence(0),
    expenses: [
      {
        id: "rent",
        name: "Rent",
        amount: pence(100000),
        frequency: "monthly",
        destinationId: null,
      },
    ],
    savingsAllocations: [],
    emergencyMonths: 1,
    targetCashShare: 0.5,
    aggressiveness: 1,
    cashDestinationId: null,
    investmentDestinationId: null,
    cashGoal: pence(400000),
    endOfYearGoal: null,
    depositGoal: pence(1000000),
    depositInvestmentFraction: 0.5,
    depositSavingsFraction: 0.6,
    jobStartMonth: null,
  };
  const result = projectSavings(
    plan,
    [previous, next],
    [{ month: next.month, result: inferSavings(previous, next, [], true) }],
    "2026-09",
  );
  expect(result?.deposit?.eligible).toBe(150000);
  expect(result?.deposit?.monthly).toBe(58910);
  expect(result?.deposit?.arrival?.months).toBe(15);
  const noGrowth = projectSavings(
    plan,
    [previous, current()],
    [{ month: next.month, result: inferSavings(previous, current(), [], true) }],
    "2026-09",
  );
  expect(noGrowth?.cashGoal?.month).toBeNull();
});
it("weights yearly and consecutive three-interval rates by eligible income", () => {
  const amounts = [
    [10000, 10000],
    [90000, 0],
    [0, 5000],
    [20000, -10000],
    [80000, 40000],
    [0, 9000],
  ];
  const metrics = amounts.map(([income, saved], index) => {
    const result = inferSavings(
      snapshot(),
      current({ periodIncome: pence(income!), cash: pence(100000 + saved!) }),
      [],
      true,
    );
    return { month: `2026-0${index + 1}`, result };
  });
  const result = projectSavings(null, [snapshot(), current()], metrics, "2026-09");
  expect(result?.yearRate).toBeCloseTo(40000 / 200000);
  expect(result?.previousRate).toBeCloseTo(10000 / 100000);
  expect(result?.recentRate).toBeCloseTo(30000 / 100000);
  expect(result?.yearSaved).toBe(54000);
});
it("has no summary savings rate without positive eligible income", () => {
  const result = projectSavings(
    null,
    [current()],
    [
      {
        month: "2026-09",
        result: inferSavings(
          snapshot(),
          current({ periodIncome: pence(0), cash: pence(120000) }),
          [],
          true,
        ),
      },
    ],
    "2026-09",
  );
  expect(result?.yearRate).toBeNull();
  expect(result?.recentRate).toBeNull();
  expect(result?.previousRate).toBeNull();
});

it("withholds savings for intervals with manual investments at either end", () => {
  const manual = {
    accountId: "manual",
    name: "Fund",
    kind: "investment" as const,
    balance: pence(10000),
  };
  for (const [before, after] of [
    [snapshot({ balances: [manual] }), current({ balances: [manual] })],
    [snapshot(), current({ balances: [manual] })],
    [snapshot({ balances: [manual] }), current()],
  ] as const) {
    expect(inferSavings(before, after, [], true)).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("Manually tracked investments"),
    });
  }
});

it("treats debt repayments and Cash/Debt reclassification consistently in net cash", () => {
  const balance = {
    accountId: "debt",
    name: "Credit card",
    kind: "cash" as const,
    balance: pence(-50000),
  };
  const before = snapshot({ cash: pence(-50000), balances: [balance] });
  const after = current({
    cash: pence(-20000),
    balances: [{ ...balance, kind: "debt", balance: pence(-20000) }],
  });
  expect(inferSavings(before, after, [], true)).toMatchObject({
    status: "complete",
    saved: 30000,
    spending: 270000,
  });
  expect(
    inferSavings(
      before,
      current({ cash: before.cash, balances: [{ ...balance, kind: "debt" }] }),
      [],
      true,
    ),
  ).toMatchObject({ status: "complete", saved: 0 });
});
