import { expect, it } from "vitest";
import { month, pence, inferSavings, readingAt, projectSavings } from "@wealth/domain";
import type { Snapshot } from "@wealth/domain";
import { prepareHistoricalSavings } from "./historical-savings";
const options = {
  connectionIds: ["broker"],
  cashCoverageId: "same-cash",
  monthlyIncome: pence(300000),
};
const historical = (period: string, cash = 100000): Snapshot => ({
  month: month(period),
  version: 1,
  source: "historical",
  capturedAt: null,
  createdAt: "2026-09-28T12:00:00Z",
  updatedAt: "2026-09-28T12:00:00Z",
  balances: [],
  investments: [],
  cash: pence(cash),
  investmentTotal: pence(100000),
  pensions: pence(200000),
  total: pence(cash + 300000),
  notes: "Imported history",
  periodIncome: null,
  cashPensionContributions: null,
});
it("enriches dated totals without inventing captured valuations, preserving amounts and doubling gap income", () => {
  const input = [
    historical("2026-05"),
    historical("2026-07", 120000),
    historical("2026-09", 140000),
  ];
  const result = prepareHistoricalSavings(input, options, new Date("2026-09-28T13:00:00Z"));
  expect(result.map((snapshot) => snapshot.periodIncome)).toEqual([null, 600000, 600000]);
  expect(result[1]).toMatchObject({
    total: 420000,
    version: 2,
    capturedAt: null,
    investments: [],
    balances: [],
    notes: "Imported history",
    cashPensionContributions: 0,
  });
  expect(input[1]?.historicalSavings).toBeUndefined();
  const metrics = result.map((next, index) => ({
    month: next.month,
    result: inferSavings(result[index - 1] ?? null, next, [], true),
  }));
  expect(metrics[0]?.result.status).toBe("unavailable");
  expect(metrics[1]?.result).toMatchObject({
    status: "complete",
    saved: 20000,
    income: 600000,
    spending: 580000,
  });
  expect(projectSavings(null, result, metrics, "2026-09")).toMatchObject({
    eligibleIntervals: 2,
    coveredDays: 123,
  });
});
it("uses London date boundaries across daylight saving and keeps undated totals unavailable", () => {
  const [winter, summer] = prepareHistoricalSavings(
    [historical("2026-03"), historical("2026-04")],
    options,
    new Date(),
  );
  expect(readingAt(winter!)).toBe("2026-03-01T00:00:00.000Z");
  expect(readingAt(summer!)).toBe("2026-03-31T23:00:00.000Z");
  expect(readingAt(historical("2026-04"))).toBeNull();
});
it("reconciles brokerage movements, not market growth, and preserves coverage safeguards", () => {
  const [before, after] = prepareHistoricalSavings(
    [historical("2026-07"), historical("2026-09", 90000)],
    options,
    new Date(),
  );
  after!.investmentTotal = pence(900000);
  const events = [
    {
      reference: "deposit",
      amount: pence(30000),
      occurredAt: "2026-08-05T12:00:00Z",
      type: "DEPOSIT",
      source: "transaction" as const,
    },
  ];
  expect(inferSavings(before!, after!, events, true)).toMatchObject({
    status: "complete",
    saved: 20000,
  });
  expect(inferSavings(before!, after!, events, false).status).toBe("unavailable");
  expect(
    inferSavings(
      before!,
      { ...after!, historicalSavings: { ...after!.historicalSavings!, connectionIds: ["other"] } },
      events,
      true,
    ).status,
  ).toBe("unavailable");
  expect(
    inferSavings(
      before!,
      { ...after!, historicalSavings: { ...after!.historicalSavings!, cashCoverageId: "other" } },
      events,
      true,
    ).status,
  ).toBe("unavailable");
  expect(
    inferSavings(
      before!,
      { ...after!, source: "current", capturedAt: "2026-09-02T12:00:00Z" },
      events,
      true,
    ).status,
  ).toBe("unavailable");
});
