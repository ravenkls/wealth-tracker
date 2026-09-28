import Decimal from "decimal.js";
import { monthlyLine } from "./budget";
import { sumMoney, pence } from "./money";
import type { BudgetPlan, Snapshot } from "./models";

export function emergencyCoverage(plan: BudgetPlan, snapshots: readonly Snapshot[]) {
  const accountIds = [...new Set(plan.emergencyAccountIds ?? [])];
  const monthlyEssentials = sumMoney(
    plan.expenses.filter((line) => line.essential).map(monthlyLine),
  );
  const configurationReason = !accountIds.length
    ? "Choose the cash accounts that make up your emergency reserve."
    : monthlyEssentials <= 0
      ? "Mark expenses with a positive monthly cost as essential to calculate coverage."
      : null;
  const points = snapshots.map((snapshot) => {
    const balances = accountIds.map((id) =>
      snapshot.balances.find((balance) => balance.accountId === id && balance.kind === "cash"),
    );
    const missing = balances.some((balance) => !balance);
    const balance =
      configurationReason || missing ? null : sumMoney(balances.map((item) => item!.balance));
    return {
      month: snapshot.month,
      balance,
      months: balance === null ? null : Math.max(0, balance) / monthlyEssentials,
      reason:
        configurationReason ??
        (missing ? "This snapshot does not include all selected cash accounts." : null),
    };
  });
  return {
    monthlyEssentials,
    targetMonths: plan.emergencyMonths,
    points,
    current: points.at(-1) ?? null,
    configurationReason,
    shortfall:
      points.at(-1)?.balance == null || plan.emergencyMonths === null
        ? null
        : pence(
            Math.max(
              0,
              new Decimal(monthlyEssentials)
                .times(plan.emergencyMonths)
                .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
                .toNumber() - points.at(-1)!.balance!,
            ),
          ),
  };
}
