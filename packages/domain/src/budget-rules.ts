import Decimal from "decimal.js";
import { pence } from "./money";
import type { Pence } from "./money";

export const payFrequencies = [
  "monthly",
  "twice-monthly",
  "weekly",
  "fortnightly",
  "four-weekly",
] as const;
export type PayFrequency = (typeof payFrequencies)[number];
const monthlyFactors: Record<PayFrequency, string> = {
  monthly: "1",
  "twice-monthly": "2",
  weekly: "4.34523783659",
  fortnightly: "2.172618918295",
  "four-weekly": "1.0833333333",
};

export function monthlyPay(amount: Pence, frequency: PayFrequency): Pence {
  return pence(
    new Decimal(amount)
      .times(monthlyFactors[frequency])
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber(),
  );
}
export function perPayPeriod(monthlyAmount: Pence, frequency: PayFrequency): Pence {
  return pence(
    new Decimal(monthlyAmount)
      .div(monthlyFactors[frequency])
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber(),
  );
}
export function annualProvision(annualAmount: Pence): Pence {
  return pence(
    new Decimal(annualAmount).div(12).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
  );
}
export function emergencyTarget(monthlyExpenses: Pence, months: number): Pence {
  if (!Number.isFinite(months) || months < 0 || monthlyExpenses < 0)
    throw new RangeError("Emergency target inputs cannot be negative.");
  return pence(
    new Decimal(monthlyExpenses).times(months).div(100000).ceil().times(100000).toNumber(),
  );
}
export function dynamicCashShare(input: {
  target: number;
  recordedCash: Pence;
  recordedInvestments: Pence;
  aggressiveness: 1 | 2 | 3;
  emergency: Pence;
}): number | null {
  if (!Number.isFinite(input.target) || input.target < 0 || input.target > 1)
    throw new RangeError("Target cash share must be between 0 and 1.");
  if (input.recordedCash < input.emergency) return 1;
  const accessible = new Decimal(input.recordedCash).plus(input.recordedInvestments);
  if (accessible.lte(0)) return null;
  const currentShare = new Decimal(input.recordedCash).div(accessible);
  const adjusted = new Decimal(input.target)
    .plus(new Decimal(input.target).minus(currentShare).times(input.aggressiveness))
    .toDecimalPlaces(2, Decimal.ROUND_UP);
  return Decimal.min(1, Decimal.max(0, adjusted)).toNumber();
}
export function roundedAllocation(surplus: Pence, share: number): Pence {
  if (!Number.isFinite(share) || share < 0 || share > 1)
    throw new RangeError("Allocation share must be between 0 and 1.");
  return pence(
    new Decimal(surplus)
      .times(share)
      .div(1000)
      .toDecimalPlaces(0, Decimal.ROUND_DOWN)
      .times(1000)
      .toNumber(),
  );
}
