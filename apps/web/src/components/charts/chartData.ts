import {
  calculateBudget,
  formatMonth,
  month,
  monthlyChart,
  monthlyLine,
  pence,
  sumMoney,
} from "@wealth/domain";
import type { BudgetPlan, HistoryRange, Month, Snapshot } from "@wealth/domain";
import type { AppData } from "../../lib/data";

export const colors = {
  cash: "#98abd2",
  investments: "#8dbca5",
  pensions: "#d4ac7c",
  saved: "#8dbca5",
  spending: "#d4ac7c",
  negative: "#dc9295",
  total: "var(--chart-total)",
};
export const palette = [
  colors.investments,
  colors.cash,
  colors.pensions,
  "#c795b2",
  "#a8bec4",
  "#b3a6ca",
  "#b7bd87",
  "#7e8795",
];
export interface AmountPoint {
  id: string;
  name: string;
  value: number;
  color?: string;
}
export interface TimePoint {
  label: string;
  detail: string;
  [key: string]: string | number | null;
}
export function categoryColor(name: string) {
  let hash = 0;
  for (const letter of name.toLowerCase()) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
}
export function distinctCategoryColors(names: readonly string[]) {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const name of [...new Set(names.map((name) => name.toLowerCase()))].sort()) {
    const preferred = palette.indexOf(categoryColor(name));
    let color = palette[preferred]!;
    for (let offset = 0; offset < palette.length; offset++) {
      const candidate = palette[(preferred + offset) % palette.length]!;
      if (!used.has(candidate)) {
        color = candidate;
        break;
      }
    }
    used.add(color);
    result.set(name, color);
  }
  return result;
}
export function historyPoints(
  snapshots: Snapshot[],
  range: HistoryRange,
  ending: Month,
): TimePoint[] {
  const byMonth = new Map(snapshots.map((snapshot) => [snapshot.month, snapshot]));
  const sorted = [...snapshots].sort((a, b) => a.month.localeCompare(b.month));
  return monthlyChart(snapshots, range, ending).map((point) => {
    const current = byMonth.get(point.month),
      index = sorted.findIndex((row) => row.month === point.month);
    const previous = index > 0 ? sorted[index - 1] : undefined;
    return {
      label: point.month,
      detail: formatMonth(point.month),
      cash: current?.cash ?? null,
      investments: current?.investmentTotal ?? null,
      pensions: current?.pensions ?? null,
      total: point.total,
      change: current && previous ? current.total - previous.total : null,
      changeDetail:
        current && previous
          ? formatMonth(previous.month) + " to " + formatMonth(current.month)
          : formatMonth(point.month),
    };
  });
}
export function savingsPoints(data: AppData, range: HistoryRange): TimePoint[] {
  return historyPoints(data.snapshots, range, data.currentMonth).map((point) => {
    const result = data.metrics.find((entry) => entry.month === point.label)?.result;
    const complete = result?.status === "complete" ? result : null;
    return {
      ...point,
      saved: complete?.saved ?? null,
      rate: complete?.rate === null || !complete ? null : complete.rate * 100,
      detail: complete
        ? new Date(complete.start).toLocaleDateString("en-GB", { timeZone: "Europe/London" }) +
          " to " +
          new Date(complete.end).toLocaleDateString("en-GB", { timeZone: "Europe/London" })
        : String(point.detail),
    };
  });
}
export function budgetChartData(plan: BudgetPlan, latest: Snapshot | null) {
  const summary = calculateBudget(plan, latest);
  const categories = new Map<string, { name: string; amounts: ReturnType<typeof pence>[] }>();
  for (const line of [...plan.expenses, ...plan.savingsAllocations]) {
    const name = line.category?.trim() || "Uncategorised",
      key = name.toLowerCase();
    const group = categories.get(key) ?? { name, amounts: [] };
    group.amounts.push(monthlyLine(line));
    categories.set(key, group);
  }
  const categoryColors = distinctCategoryColors([...categories.keys()]);
  const allocation: AmountPoint[] = [
    { id: "expenses", name: "Expenses", value: summary.spending, color: colors.spending },
    { id: "planned", name: "Planned savings", value: summary.explicitSavings, color: colors.saved },
  ];
  if (summary.surplus < 0)
    allocation.push({
      id: "deficit",
      name: "Shortfall",
      value: summary.surplus,
      color: colors.negative,
    });
  else if (summary.cashAllocation === null || summary.investmentAllocation === null)
    allocation.push({
      id: "unallocated",
      name: "Unallocated surplus",
      value: summary.surplus,
      color: colors.cash,
    });
  else
    allocation.push(
      { id: "cash", name: "Surplus to cash", value: summary.cashAllocation, color: colors.cash },
      {
        id: "investments",
        name: "Surplus to investments",
        value: summary.investmentAllocation,
        color: colors.investments,
      },
      { id: "remainder", name: "Unallocated", value: summary.remainder ?? 0, color: "#7e8795" },
    );
  return {
    summary,
    allocation,
    expenses: plan.expenses
      .map((line) => ({
        id: line.id,
        name: line.name,
        value: monthlyLine(line),
        color: categoryColors.get((line.category?.trim() || "Uncategorised").toLowerCase())!,
      }))
      .sort((a, b) => b.value - a.value),
    categories: [...categories]
      .map(([id, group]) => ({
        id,
        name: group.name,
        value: sumMoney(group.amounts),
        color: categoryColors.get(id)!,
      }))
      .sort((a, b) => b.value - a.value),
  };
}
export function shortMonth(value: unknown) {
  return formatMonth(month(String(value))).replace(/^(\w{3})\w* (\d{2})(\d{2})$/, "$1 $3");
}
