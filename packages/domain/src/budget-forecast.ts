import { calculateBudget } from "./budget";
import { month, type Month } from "./month";
import { pence, sumMoney, type Pence } from "./money";
import type { BudgetPlan, Snapshot } from "./models";

export interface ForecastPoint {
  month: Month;
  cash: Pence;
  investments: Pence;
  total: Pence;
}
export type BudgetForecast =
  | { status: "complete"; points: ForecastPoint[]; monthlyChange: Pence }
  | { status: "unavailable"; reason: string };

export function forecastBudget(
  plan: BudgetPlan,
  latest: Snapshot | null,
  months: number,
): BudgetForecast {
  if (!Number.isInteger(months) || months < 1 || months > 60)
    throw new RangeError("Forecast length must be between 1 and 60 months.");
  if (!latest)
    return {
      status: "unavailable",
      reason: "Record a snapshot to set the forecast’s starting balances.",
    };
  const points: ForecastPoint[] = [
    {
      month: latest.month,
      cash: latest.cash,
      investments: latest.investmentTotal,
      total: sumMoney([latest.cash, latest.investmentTotal]),
    },
  ];
  let projected = { ...latest };
  const initial = calculateBudget(plan, latest);
  const start = Number(latest.month.slice(0, 4)) * 12 + Number(latest.month.slice(5)) - 1;
  for (let step = 1; step <= months; step++) {
    const summary = calculateBudget(plan, projected);
    if (summary.surplus > 0 && summary.investmentAllocation === null)
      return {
        status: "unavailable",
        reason:
          "Set emergency cover and the target cash share, with balances that allow a cash/investment split, to project this surplus.",
      };
    // Savings allocations and untransferred rounding remain cash; a deficit draws down cash.
    const investmentChange = summary.investmentAllocation ?? pence(0);
    const cashChange = pence(summary.income - summary.spending - investmentChange);
    const ordinal = start + step;
    const nextMonth = month(
      `${String(Math.floor(ordinal / 12)).padStart(4, "0")}-${String((ordinal % 12) + 1).padStart(2, "0")}`,
    );
    projected = {
      ...projected,
      month: nextMonth,
      cash: sumMoney([projected.cash, cashChange]),
      investmentTotal: sumMoney([projected.investmentTotal, investmentChange]),
    };
    projected.total = sumMoney([projected.cash, projected.investmentTotal, projected.pensions]);
    points.push({
      month: nextMonth,
      cash: projected.cash,
      investments: projected.investmentTotal,
      total: sumMoney([projected.cash, projected.investmentTotal]),
    });
  }
  return { status: "complete", points, monthlyChange: pence(initial.income - initial.spending) };
}
