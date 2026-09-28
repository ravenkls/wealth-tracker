import { month } from "./month";
import type { Month } from "./month";
import type { Pence } from "./money";

export interface MonthlyValue {
  readonly month: Month;
  readonly total: Pence;
}
export type HistoryRange = "6M" | "YTD" | "1Y" | "All";
function ordinal(value: Month) {
  const [year, period] = value.split("-").map(Number);
  return year! * 12 + period! - 1;
}
function fromOrdinal(value: number): Month {
  return month(
    `${String(Math.floor(value / 12)).padStart(4, "0")}-${String((value % 12) + 1).padStart(2, "0")}`,
  );
}
export function monthDistance(earlier: Month, later: Month) {
  return ordinal(later) - ordinal(earlier);
}

export function monthlyChart(
  values: readonly MonthlyValue[],
  range: HistoryRange,
  ending: Month,
): { month: Month; total: Pence | null }[] {
  const byMonth = new Map<Month, Pence>();
  for (const value of values) {
    month(value.month);
    if (byMonth.has(value.month))
      throw new Error("Chart input must contain only one active snapshot per month.");
    byMonth.set(value.month, value.total);
  }
  if (values.length === 0) return [];
  const end = ordinal(ending);
  const earliest = Math.min(...values.map((value) => ordinal(value.month)));
  const start =
    range === "All"
      ? earliest
      : Math.max(
          earliest,
          range === "6M" ? end - 5 : range === "1Y" ? end - 11 : Math.floor(end / 12) * 12,
        );
  const points: { month: Month; total: Pence | null }[] = [];
  for (let index = start; index <= end; index++) {
    const period = fromOrdinal(index);
    points.push({ month: period, total: byMonth.get(period) ?? null });
  }
  return points;
}
