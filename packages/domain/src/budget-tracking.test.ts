import { expect, it } from "vitest";
import { monthPace, trackBudget } from "./budget-tracking";
import { pence } from "./money";
import { month } from "./month";
import type { BudgetPlan } from "./models";

const line = (category: string, amount: number, frequency: "monthly" | "annual" = "monthly") => ({
  id: `${category}-${amount}`,
  name: category,
  category,
  amount: pence(amount),
  frequency,
  destinationId: null,
});
const plan = {
  expenses: [
    line("Food", 30000),
    line(" food ", 10000),
    line("Transport", 10000),
    line("Insurance", 60000, "annual"),
    line("Gifts", 5000),
    { ...line("", 999), category: null },
  ],
} as BudgetPlan;

it("paces the current month and treats past months as complete", () => {
  expect(monthPace(month("2026-09"), "2026-09-15")).toBe(0.5);
  expect(monthPace(month("2026-08"), "2026-09-15")).toBe(1);
  expect(monthPace(month("2026-10"), "2026-09-15")).toBe(0);
});
it("tracks linked categories, year-to-date annual lines and unbudgeted spend", () => {
  const result = trackBudget({
    plan,
    links: [
      { id: "groceries", budgetCategory: "FOOD" },
      { id: "takeaway", budgetCategory: "Food" },
      { id: "trains", budgetCategory: "Transport" },
      { id: "cover", budgetCategory: "Insurance" },
      { id: "stale", budgetCategory: "Removed" },
      { id: "fun", budgetCategory: null },
    ],
    month: month("2026-03"),
    today: "2026-03-15",
    monthSpend: new Map([
      ["groceries", 15000],
      ["takeaway", 5000],
      ["trains", 9000],
      ["cover", 60000],
      ["stale", 700],
      ["fun", 300],
      ["uncategorised", 1000],
    ]),
    yearSpend: new Map([["cover", 60000]]),
  });
  const byName = Object.fromEntries(result.categories.map((c) => [c.name, c]));
  expect(byName.Food).toMatchObject({
    period: "month",
    budget: 40000,
    allowance: 19355,
    spent: 20000,
    status: "ahead",
  });
  expect(byName.Transport).toMatchObject({ budget: 10000, spent: 9000, status: "ahead" });
  expect(byName.Insurance).toMatchObject({
    period: "year",
    budget: 60000,
    spent: 60000,
    status: "on-track",
  });
  expect(byName.Gifts?.status).toBe("unlinked");
  expect(result).toMatchObject({ onTrack: 1, tracked: 3, unbudgeted: 2000 });
  expect(result.score).toBeCloseTo(5000 / 55000);
});
it("marks overspending and has no score without links", () => {
  const over = trackBudget({
    plan,
    links: [{ id: "trains", budgetCategory: "Transport" }],
    month: month("2026-02"),
    today: "2026-03-01",
    monthSpend: new Map([["trains", 10001]]),
    yearSpend: new Map(),
  });
  expect(over.categories.find((c) => c.name === "Transport")?.status).toBe("over");
  expect(over.score).toBe(0);
  expect(
    trackBudget({
      plan,
      links: [],
      month: month("2026-02"),
      today: "2026-03-01",
      monthSpend: new Map(),
      yearSpend: new Map(),
    }).score,
  ).toBeNull();
});
