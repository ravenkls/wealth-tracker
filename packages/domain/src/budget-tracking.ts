import { canonicalCategory } from "./categories";
import { pence, type Pence } from "./money";
import type { Month } from "./month";
import type { BudgetPlan } from "./models";

export type TrackingStatus = "on-track" | "ahead" | "over" | "unlinked";
export interface TrackedCategory {
  name: string;
  analysisCategoryIds: string[];
  period: "month" | "year";
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
// Categories with annual lines are judged year-to-date so a single yearly payment isn't "over".
export function trackBudget(input: {
  plan: BudgetPlan;
  links: readonly { id: string; budgetCategory?: string | null }[];
  month: Month;
  today: string;
  monthSpend: ReadonlyMap<string, number>;
  yearSpend: ReadonlyMap<string, number>;
}): BudgetTracking {
  const names: string[] = [];
  const amounts = new Map<string, { monthly: number; annual: number }>();
  for (const line of input.plan.expenses) {
    const name = canonicalCategory(line.category, names);
    if (!name) continue;
    if (!names.includes(name)) names.push(name);
    const amount = amounts.get(name) ?? { monthly: 0, annual: 0 };
    amount[line.frequency === "annual" ? "annual" : "monthly"] += line.amount;
    amounts.set(name, amount);
  }
  const linked = new Map<string, string[]>();
  for (const link of input.links) {
    const name = canonicalCategory(link.budgetCategory, names);
    if (name && amounts.has(name)) linked.set(name, [...(linked.get(name) ?? []), link.id]);
  }
  const pace = monthPace(input.month, input.today);
  const elapsedMonths = Number(input.month.slice(5, 7)) - 1;
  const total = (spend: ReadonlyMap<string, number>, ids: readonly string[]) =>
    pence(Math.round(ids.reduce((sum, id) => sum + (spend.get(id) ?? 0), 0)));
  const categories = names.map((name): TrackedCategory => {
    const { monthly, annual } = amounts.get(name)!;
    const ids = linked.get(name) ?? [];
    const period = annual ? "year" : "month";
    const months = period === "year" ? elapsedMonths : 0;
    const budget = pence(monthly * (months + 1) + annual);
    const allowance = pence(Math.round(monthly * (months + pace) + annual));
    const spent = total(period === "year" ? input.yearSpend : input.monthSpend, ids);
    const status = !ids.length
      ? "unlinked"
      : spent <= allowance
        ? "on-track"
        : spent <= budget
          ? "ahead"
          : "over";
    return { name, analysisCategoryIds: ids, period, budget, allowance, spent, status };
  });
  const trackedCategories = categories.filter((category) => category.status !== "unlinked");
  // Weight by monthly-equivalent budget so large categories dominate the score.
  const weight = (category: TrackedCategory) => {
    const { monthly, annual } = amounts.get(category.name)!;
    return monthly + annual / 12;
  };
  const totalWeight = trackedCategories.reduce((sum, category) => sum + weight(category), 0);
  const onTrack = trackedCategories.filter((category) => category.status === "on-track");
  const linkedIds = new Set(trackedCategories.flatMap((category) => category.analysisCategoryIds));
  return {
    categories,
    score: totalWeight
      ? onTrack.reduce((sum, category) => sum + weight(category), 0) / totalWeight
      : null,
    onTrack: onTrack.length,
    tracked: trackedCategories.length,
    unbudgeted: pence(
      Math.round(
        [...input.monthSpend].reduce(
          (sum, [id, value]) => sum + (linkedIds.has(id) ? 0 : value),
          0,
        ),
      ),
    ),
  };
}
