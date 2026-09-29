import {
  annualProvision,
  dynamicCashShare,
  emergencyTarget,
  monthlyPay,
  perPayPeriod,
  roundedAllocation,
} from "./budget-rules";
import { pence, sumMoney } from "./money";
import type { BudgetLine, BudgetPlan, Snapshot, ManualAccount } from "./models";
export function monthlyLine(line: BudgetLine) {
  return line.frequency === "annual" ? annualProvision(line.amount) : line.amount;
}
export type BudgetDestination = Pick<ManualAccount, "id" | "kind">;
export function calculateBudget(
  plan: BudgetPlan,
  latest: Snapshot | null,
  targets: readonly BudgetDestination[] = [],
) {
  const income = sumMoney([monthlyPay(plan.salary, plan.payFrequency), plan.sideIncome]);
  const spending = sumMoney(plan.expenses.map(monthlyLine));
  const explicitSavings = sumMoney(plan.savingsAllocations.map(monthlyLine));
  const kinds = new Map<string, ManualAccount["kind"]>([
    ...(latest?.balances.map((account) => [account.accountId, account.kind] as const) ?? []),
    ...(latest?.investments.map((account) => [account.connectionId, "investment"] as const) ?? []),
    ...targets.map((account) => [account.id, account.kind] as const),
  ]);
  const investmentSavings = sumMoney(
    plan.savingsAllocations
      .filter((line) => line.destinationId && kinds.get(line.destinationId) === "investment")
      .map(monthlyLine),
  );
  const pensionSavings = sumMoney(
    plan.savingsAllocations
      .filter((line) => line.destinationId && kinds.get(line.destinationId) === "pension")
      .map(monthlyLine),
  );
  const surplus = pence(income - spending - explicitSavings);
  const emergency =
    plan.emergencyMonths === null ? null : emergencyTarget(spending, plan.emergencyMonths);
  const cashShare =
    latest && plan.targetCashShare !== null && emergency !== null
      ? dynamicCashShare({
          target: plan.targetCashShare,
          recordedCash: latest.cash,
          recordedInvestments: latest.investmentTotal,
          aggressiveness: plan.aggressiveness,
          emergency,
        })
      : null;
  const cashAllocation =
    cashShare === null || surplus < 0 ? null : roundedAllocation(surplus, cashShare);
  const investmentAllocation =
    cashShare === null || surplus < 0 ? null : roundedAllocation(surplus, 1 - cashShare);
  const remainder =
    cashAllocation === null || investmentAllocation === null
      ? null
      : pence(surplus - cashAllocation - investmentAllocation);
  const destinations = new Map<string, number>();
  for (const line of [...plan.expenses, ...plan.savingsAllocations])
    if (line.destinationId)
      destinations.set(
        line.destinationId,
        (destinations.get(line.destinationId) ?? 0) + monthlyLine(line),
      );
  if (plan.cashDestinationId && cashAllocation !== null)
    destinations.set(
      plan.cashDestinationId,
      (destinations.get(plan.cashDestinationId) ?? 0) + cashAllocation,
    );
  if (plan.investmentDestinationId && investmentAllocation !== null)
    destinations.set(
      plan.investmentDestinationId,
      (destinations.get(plan.investmentDestinationId) ?? 0) + investmentAllocation,
    );
  return {
    income,
    spending,
    explicitSavings,
    investmentSavings,
    pensionSavings,
    surplus,
    emergency,
    cashShare,
    cashAllocation,
    investmentAllocation,
    remainder,
    plannedSavingsRate: income > 0 ? (income - spending - pensionSavings) / income : null,
    funding: [...destinations].map(([destinationId, value]) => ({
      destinationId,
      monthly: pence(value),
      perPayPeriod: perPayPeriod(pence(value), plan.payFrequency),
    })),
  };
}
