import { expect, it } from "vitest";
import { canonicalCategory, normalizeBudgetCategories } from "./categories";
import { pence } from "./money";
import type { BudgetPlan } from "./models";

it("trims free-text categories and reuses existing spelling without case duplicates", () => {
  expect(canonicalCategory("  food  ", ["Food"])).toBe("Food");
  expect(canonicalCategory("  Travel  ", ["Food"])).toBe("Travel");
  expect(canonicalCategory("   ")).toBeNull();
  expect(canonicalCategory(undefined)).toBeNull();
});
it("normalises both budget sections without changing amounts or legacy lines", () => {
  const line = {
    id: "a",
    name: "Groceries",
    amount: pence(12345),
    frequency: "monthly" as const,
    destinationId: null,
  };
  const plan = {
    expenses: [
      { ...line, category: " Food " },
      { ...line, id: "b" },
    ],
    savingsAllocations: [{ ...line, id: "c", category: "food" }],
  } as BudgetPlan;
  const result = normalizeBudgetCategories(plan);
  expect(result.expenses[0]).toEqual({ ...line, category: "Food" });
  expect(result.expenses[1]?.category).toBeNull();
  expect(result.savingsAllocations[0]?.category).toBe("Food");
  expect(plan.expenses[0]?.category).toBe(" Food ");
});
