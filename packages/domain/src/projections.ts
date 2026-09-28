import { readingAt } from "./snapshot-reading";
import Decimal from "decimal.js";
import { pence, sumMoney } from "./money";
import { month } from "./month";
import { monthDistance } from "./history";
import { calculateBudget } from "./budget";
import type { BudgetPlan, Snapshot } from "./models";
import type { SavingsResult, SavingsMetrics } from "./savings";
const day = 86_400_000;
const monthDays = "30.436875";
function londonMonth(instant: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(instant));
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}
export function projectSavings(
  plan: BudgetPlan | null,
  snapshots: readonly Snapshot[],
  metrics: readonly { month: string; result: SavingsResult }[],
  currentMonth: string,
) {
  const latest = snapshots.at(-1);
  if (!latest) return null;
  const latestMonth = latest.month;
  const latestReading = readingAt(latest);
  const end = latestReading ? Date.parse(latestReading) : null;
  const complete = metrics.flatMap((entry) =>
    entry.result.status === "complete" ? [{ month: entry.month, ...entry.result }] : [],
  );
  const within = (days: number) =>
    complete.filter(
      (result) =>
        end !== null &&
        Date.parse(result.end) <= end &&
        Date.parse(result.start) >= end - days * day &&
        (!plan?.jobStartMonth || londonMonth(result.start) >= plan.jobStartMonth),
    );
  const eligible = within(365);
  const coveredDays = eligible.reduce(
    (sum, result) => sum + (Date.parse(result.end) - Date.parse(result.start)) / day,
    0,
  );
  function monthly(
    key: "saved" | "cashSaved" | "spending",
    values: readonly SavingsMetrics[] = eligible,
  ) {
    const days = values.reduce(
      (sum, result) => sum + (Date.parse(result.end) - Date.parse(result.start)) / day,
      0,
    );
    return days
      ? pence(
          new Decimal(sumMoney(values.map((result) => result[key])))
            .div(days)
            .times(monthDays)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toNumber(),
        )
      : null;
  }
  const monthlyCash = monthly("cashSaved"),
    monthlySaved = monthly("saved");
  const remainingMonths = Math.max(
    0,
    monthDistance(latest.month, month(`${currentMonth.slice(0, 4)}-12`)),
  );
  function arrival(target: number | null | undefined, current: number, rate: number | null) {
    if (target === null || target === undefined) return null;
    if (current >= target) return { reached: true, month: null, months: 0 };
    if (rate === null || rate <= 0) return { reached: false, month: null, months: null };
    const count = Math.ceil((target - current) / rate);
    const ordinal = Number(latestMonth.slice(0, 4)) * 12 + Number(latestMonth.slice(5)) - 1 + count;
    return {
      reached: false,
      month:
        ordinal < 120000
          ? month(
              `${Math.floor(ordinal / 12)
                .toString()
                .padStart(4, "0")}-${String((ordinal % 12) + 1).padStart(2, "0")}`,
            )
          : null,
      months: count,
    };
  }
  const weightedRate = (values: readonly SavingsMetrics[]) => {
    const eligibleRates = values.filter((result) => result.income > 0 && result.rate !== null);
    const income = sumMoney(eligibleRates.map((result) => result.income));
    return income > 0 ? sumMoney(eligibleRates.map((result) => result.saved)) / income : null;
  };
  const yearMetrics = complete.filter((result) =>
    result.month.startsWith(currentMonth.slice(0, 4)),
  );
  const emergency = plan ? calculateBudget(plan, latest).emergency : null;
  const deposit =
    plan &&
    plan.depositGoal !== null &&
    plan.depositInvestmentFraction !== null &&
    plan.depositSavingsFraction !== null &&
    emergency !== null
      ? {
          target: plan.depositGoal,
          eligible: pence(
            new Decimal(Math.max(0, latest.cash - emergency))
              .plus(new Decimal(latest.investmentTotal).times(plan.depositInvestmentFraction))
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
              .toNumber(),
          ),
          monthly:
            monthlySaved === null
              ? null
              : pence(
                  new Decimal(monthlySaved)
                    .times(plan.depositSavingsFraction)
                    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
                    .toNumber(),
                ),
        }
      : null;
  return {
    monthlyCash,
    monthlySaved,
    coveredDays,
    eligibleIntervals: eligible.length,
    asOf: latest.month,
    projectedYearEndCash:
      monthlyCash === null ? null : pence(latest.cash + monthlyCash * remainingMonths),
    yearEndMonthlyGap:
      plan?.endOfYearGoal === null || plan?.endOfYearGoal === undefined || remainingMonths === 0
        ? null
        : pence(Math.ceil((plan.endOfYearGoal - latest.cash) / remainingMonths)),
    cashGoal: arrival(plan?.cashGoal, latest.cash, monthlyCash),
    yearSaved: yearMetrics.length ? sumMoney(yearMetrics.map((result) => result.saved)) : null,
    yearRate: weightedRate(yearMetrics),
    recentRate: weightedRate(complete.slice(-3)),
    previousRate: weightedRate(complete.slice(-6, -3)),
    averageSpending: monthly("spending", within(365.2425 / 2)),
    deposit: deposit
      ? { ...deposit, arrival: arrival(deposit.target, deposit.eligible, deposit.monthly) }
      : null,
  };
}
