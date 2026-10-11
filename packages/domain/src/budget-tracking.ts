import { canonicalCategory } from "./categories";
import { pence, type Pence } from "./money";
import type { Month } from "./month";
import type { BudgetPlan } from "./models";

export type TrackingStatus = "on-track" | "ahead" | "over" | "unlinked";
export interface TrackedCategory {
  name: string;
  analysisCategoryIds: string[];
  budget: Pence;
  allowance: Pence;
  spent: Pence;
  status: TrackingStatus;
}
export interface BudgetTracking {
  categories: TrackedCategory[];
  score: number | null;
  onTrack: number;
  tracked: number;
  unbudgeted: Pence;
}
// Share of the selected month that has elapsed by `today`.
export function monthPace(selected: Month, today: string) {
  const current = today.slice(0, 7);
  if (selected < current) return 1;
  if (selected > current) return 0;
  const [year, monthNumber] = selected.split("-").map(Number);
  return Number(today.slice(8, 10)) / new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
}
// Annual lines are ignored: their payments land in one month and can't be paced monthly.
export function monthlyBudgets(plan: Pick<BudgetPlan, "expenses">) {
  const budgets = new Map<string, number>();
  for (const line of plan.expenses) {
    if (line.frequency === "annual") continue;
    const name = canonicalCategory(line.category, [...budgets.keys()]);
    if (name) budgets.set(name, (budgets.get(name) ?? 0) + line.amount);
  }
  return budgets;
}
export function trackBudget(input: {
  plan: BudgetPlan;
  links: readonly { id: string; budgetCategory?: string | null }[];
  month: Month;
  today: string;
  spend: ReadonlyMap<string, number>;
}): BudgetTracking {
  const budgets = monthlyBudgets(input.plan);
  const names = [...budgets.keys()];
  const linked = new Map<string, string[]>();
  for (const link of input.links) {
    const name = canonicalCategory(link.budgetCategory, names);
    if (name && budgets.has(name)) linked.set(name, [...(linked.get(name) ?? []), link.id]);
  }
  const pace = monthPace(input.month, input.today);
  const categories = names.map((name): TrackedCategory => {
    const budget = pence(budgets.get(name)!);
    const ids = linked.get(name) ?? [];
    const allowance = pence(Math.round(budget * pace));
    const spent = pence(Math.round(ids.reduce((sum, id) => sum + (input.spend.get(id) ?? 0), 0)));
    const status = !ids.length
      ? "unlinked"
      : spent <= allowance
        ? "on-track"
        : spent <= budget
          ? "ahead"
          : "over";
    return { name, analysisCategoryIds: ids, budget, allowance, spent, status };
  });
  const tracked = categories.filter((category) => category.status !== "unlinked");
  const onTrack = tracked.filter((category) => category.status === "on-track");
  // Weight by budget so large categories dominate the score.
  const totalBudget = tracked.reduce((sum, category) => sum + category.budget, 0);
  const linkedIds = new Set(tracked.flatMap((category) => category.analysisCategoryIds));
  return {
    categories,
    score: totalBudget
      ? onTrack.reduce((sum, category) => sum + category.budget, 0) / totalBudget
      : null,
    onTrack: onTrack.length,
    tracked: tracked.length,
    unbudgeted: pence(
      Math.round(
        [...input.spend].reduce((sum, [id, value]) => sum + (linkedIds.has(id) ? 0 : value), 0),
      ),
    ),
  };
}
export interface LiveBudgetTotals {
  budget: Pence;
  spent: Pence;
}
export interface LiveBudgetRow {
  id: string;
  name: string;
  budget: Pence | null;
  spent: Pence;
  counted: boolean;
}
export interface LiveBudget extends LiveBudgetTotals {
  budgetRows: LiveBudgetRow[];
  spendingRows: LiveBudgetRow[];
  // Uncategorised or deleted-category spending, which always counts.
  other: Pence;
}
// Excluding a budget category drops its budget and linked spending; unlinked categories drop spending.
export function liveBudget(input: {
  plan: BudgetPlan;
  categories: readonly { id: string; name: string; budgetCategory?: string | null }[];
  spend: ReadonlyMap<string, number>;
}): LiveBudget {
  const budgets = monthlyBudgets(input.plan);
  const names = [...budgets.keys()];
  const excludedBudgets = new Set(
    (input.plan.liveBudgetExclusions ?? []).map((name) => canonicalCategory(name, names)),
  );
  const excludedIds = new Set(input.plan.liveBudgetExcludedCategoryIds ?? []);
  const spentOf = (ids: readonly string[]) =>
    pence(Math.round(ids.reduce((sum, id) => sum + (input.spend.get(id) ?? 0), 0)));
  const linkOf = (category: (typeof input.categories)[number]) => {
    const name = canonicalCategory(category.budgetCategory, names);
    return name && budgets.has(name) ? name : null;
  };
  const budgetRows = names.map((name): LiveBudgetRow => ({
    id: name,
    name,
    budget: pence(budgets.get(name)!),
    spent: spentOf(input.categories.filter((c) => linkOf(c) === name).map((c) => c.id)),
    counted: !excludedBudgets.has(name),
  }));
  const spendingRows = input.categories
    .filter((category) => !linkOf(category))
    .map((category): LiveBudgetRow => ({
      id: category.id,
      name: category.name,
      budget: null,
      spent: spentOf([category.id]),
      counted: !excludedIds.has(category.id),
    }));
  const known = new Set(input.categories.map((category) => category.id));
  const other = spentOf([...input.spend.keys()].filter((id) => !known.has(id)));
  const counted = [...budgetRows, ...spendingRows].filter((row) => row.counted);
  return {
    budget: pence(counted.reduce((sum, row) => sum + (row.budget ?? 0), 0)),
    spent: pence(counted.reduce((sum, row) => sum + row.spent, Number(other))),
    budgetRows,
    spendingRows,
    other,
  };
}
// Budget accrues evenly between `start` and `end`; a deficit resumes once accrual catches up.
export function liveBudgetAt(totals: LiveBudgetTotals, start: number, end: number, now: number) {
  const available = totals.budget * ((now - start) / (end - start)) - totals.spent;
  if (available >= 0) return { available, resumesAt: null };
  const caughtUp = totals.budget ? start + (totals.spent / totals.budget) * (end - start) : end;
  return { available, resumesAt: Math.min(caughtUp, end) };
}
