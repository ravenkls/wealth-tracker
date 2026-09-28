import { calculateBudget } from "./budget";
import { forecastBudget } from "./budget-forecast";
import { dynamicCashShare, roundedAllocation } from "./budget-rules";
import { defaultForecastAssumptions, validateForecastAssumptions } from "./forecast-assumptions";
import type { BudgetPlan, ForecastAssumptions, Snapshot } from "./models";
import { pence, sumMoney, type Pence } from "./money";
import type { Month } from "./month";

export interface SimulationRange {
  low: Pence;
  median: Pence;
  high: Pence;
}
export interface SimulationPoint {
  month: Month;
  cash: SimulationRange;
  investments: SimulationRange;
  total: SimulationRange;
}
export type BudgetSimulation =
  | { status: "unavailable"; reason: string }
  | {
      status: "complete";
      points: SimulationPoint[];
      paths: number;
      brokerageCash: Pence;
      hasUnknownCash: boolean;
    };

// A fixed seed gives changes in the budget the same sequence of sampled conditions.
function randomSource(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return (((value ^ (value >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}
function spendingAdjustment(assumptions: ForecastAssumptions, draw: number) {
  const { spendingLow: low, spendingUsual: usual, spendingHigh: high } = assumptions;
  if (low === high) return low;
  const span = high - low;
  return Math.round(
    draw < (usual - low) / span
      ? low + Math.sqrt(draw * span * (usual - low))
      : high - Math.sqrt((1 - draw) * span * (high - usual)),
  );
}
function range(samples: number[]): SimulationRange {
  samples.sort((left, right) => left - right);
  const quantile = (fraction: number) => {
    const index = (samples.length - 1) * fraction;
    const low = Math.floor(index);
    return pence(
      Math.round(samples[low]! + (samples[Math.ceil(index)]! - samples[low]!) * (index - low)),
    );
  };
  return { low: quantile(0.1), median: quantile(0.5), high: quantile(0.9) };
}

export function simulateBudget(
  plan: BudgetPlan,
  latest: Snapshot | null,
  months: number,
  options: { paths?: number; seed?: number } = {},
): BudgetSimulation {
  const assumptions = plan.forecastAssumptions ?? defaultForecastAssumptions;
  validateForecastAssumptions(assumptions);
  const baseline = forecastBudget(plan, latest, months);
  if (baseline.status === "unavailable") return baseline;
  if (!latest) return { status: "unavailable", reason: "Record a snapshot before simulating." };
  const paths = options.paths ?? 2000;
  if (!Number.isInteger(paths) || paths < 1 || paths > 10000)
    throw new RangeError("Simulation requires between 1 and 10,000 paths.");
  if (
    latest.investmentTotal < 0 ||
    latest.investments.some((account) => account.cash < 0 || account.cash > account.total)
  )
    return {
      status: "unavailable",
      reason:
        "Investment balances must be nonnegative, with brokerage cash no greater than its account value.",
    };
  const brokerageCash = sumMoney(latest.investments.map((account) => account.cash));
  if (brokerageCash > latest.investmentTotal)
    return {
      status: "unavailable",
      reason:
        "Recorded brokerage cash exceeds the investment total. Correct the snapshot before simulating.",
    };
  const hasUnknownCash =
    latest.investmentTotal > sumMoney(latest.investments.map((account) => account.total));
  const summary = calculateBudget(plan, latest);
  const samples = baseline.points.map(() => ({
    cash: [] as number[],
    investments: [] as number[],
    total: [] as number[],
  }));
  const drift = Math.log1p(assumptions.annualGrowth) / 12;
  const volatility = assumptions.annualVolatility / Math.sqrt(12);
  for (let path = 0; path < paths; path++) {
    const random = randomSource((options.seed ?? 1729) + path);
    let cash = latest.cash;
    let investments = latest.investmentTotal;
    for (let step = 0; step <= months; step++) {
      if (step > 0) {
        const spending = pence(
          Math.max(
            0,
            sumMoney([summary.spending, pence(spendingAdjustment(assumptions, random()))]),
          ),
        );
        const surplus = pence(summary.income - spending - summary.explicitSavings);
        const share =
          plan.targetCashShare !== null && summary.emergency !== null
            ? dynamicCashShare({
                target: plan.targetCashShare,
                recordedCash: cash,
                recordedInvestments: investments,
                aggressiveness: plan.aggressiveness,
                emergency: summary.emergency,
              })
            : null;
        if (surplus > 0 && share === null)
          return {
            status: "unavailable",
            reason: "Set emergency cover and the target cash share to allocate simulated savings.",
          };
        const contribution =
          surplus > 0 && share !== null ? roundedAllocation(surplus, 1 - share) : pence(0);
        const normal = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
        const exposed = investments - brokerageCash;
        investments = sumMoney([
          brokerageCash,
          pence(Math.round(exposed * Math.exp(drift + volatility * normal))),
          contribution,
        ]);
        cash = sumMoney([cash, summary.income, pence(-spending), pence(-contribution)]);
      }
      const sample = samples[step]!;
      sample.cash.push(cash);
      sample.investments.push(investments);
      sample.total.push(sumMoney([cash, investments]));
    }
  }
  return {
    status: "complete",
    paths,
    brokerageCash,
    hasUnknownCash,
    points: baseline.points.map((point, index) => ({
      month: point.month,
      cash: range(samples[index]!.cash),
      investments: range(samples[index]!.investments),
      total: range(samples[index]!.total),
    })),
  };
}
