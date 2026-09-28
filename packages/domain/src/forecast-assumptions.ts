import type { ForecastAssumptions } from "./models";
import { pence } from "./money";

export const defaultForecastAssumptions: Readonly<ForecastAssumptions> = {
  spendingLow: pence(0),
  spendingUsual: pence(0),
  spendingHigh: pence(0),
  annualGrowth: 0.05,
  annualVolatility: 0.18,
};

export function validateForecastAssumptions(value: ForecastAssumptions): void {
  for (const amount of [value.spendingLow, value.spendingUsual, value.spendingHigh]) pence(amount);
  if (value.spendingLow > value.spendingUsual || value.spendingUsual > value.spendingHigh)
    throw new RangeError("Spending adjustments must be ordered lowest, usual, highest.");
  if (!Number.isFinite(value.annualGrowth) || value.annualGrowth <= -1 || value.annualGrowth > 1)
    throw new RangeError("Annual growth must be above -100% and at most 100%.");
  if (
    !Number.isFinite(value.annualVolatility) ||
    value.annualVolatility < 0 ||
    value.annualVolatility > 2
  )
    throw new RangeError("Annual volatility must be between 0% and 200%.");
}
