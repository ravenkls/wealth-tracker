import { accountAsset } from "./account-types";
import type { Snapshot } from "./models";
import { sumMoney } from "./money";
import type { Pence } from "./money";

export interface NetWorthBalances {
  readonly cash: readonly Pence[];
  readonly investments: readonly Pence[];
  readonly pensions: readonly Pence[];
}

export function calculateNetWorth(balances: NetWorthBalances) {
  const cash = sumMoney(balances.cash);
  const investments = sumMoney(balances.investments);
  const pensions = sumMoney(balances.pensions);
  const excludingPensions = sumMoney([cash, investments]);
  return {
    cash,
    investments,
    pensions,
    excludingPensions,
    total: sumMoney([excludingPensions, pensions]),
  };
}

export function calculateRecordedNetWorth(
  balances: Snapshot["balances"],
  investments: Snapshot["investments"],
) {
  const amounts = (asset: "cash" | "investments" | "pensions") =>
    balances.filter((row) => accountAsset(row.kind) === asset).map((row) => row.balance);
  return calculateNetWorth({
    cash: amounts("cash"),
    pensions: amounts("pensions"),
    investments: [...amounts("investments"), ...investments.map((row) => row.total)],
  });
}
