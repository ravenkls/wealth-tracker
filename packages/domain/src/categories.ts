import type { BudgetPlan } from "./models";

export function canonicalCategory(
  value: string | null | undefined,
  existing: readonly string[] = [],
) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return (
    existing.find(
      (name) => name.toLocaleLowerCase("en-GB") === trimmed.toLocaleLowerCase("en-GB"),
    ) ?? trimmed
  );
}

export function normalizeBudgetCategories(plan: BudgetPlan): BudgetPlan {
  const names: string[] = [];
  const normalize = (line: BudgetPlan["expenses"][number]) => {
    const category = canonicalCategory(line.category, names);
    if (category && !names.includes(category)) names.push(category);
    return { ...line, category };
  };
  return {
    ...plan,
    expenses: plan.expenses.map(normalize),
    savingsAllocations: plan.savingsAllocations.map(normalize),
  };
}
