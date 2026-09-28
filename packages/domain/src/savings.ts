import { readingAt, savingsConnectionIds } from "./snapshot-reading";
import { isCashAccount } from "./account-types";
import { pence } from "./money";
import type { CashEvent, Snapshot } from "./models";
import type { Pence } from "./money";
export interface SavingsMetrics {
  status: "complete";
  start: string;
  end: string;
  cashSaved: Pence;
  saved: Pence;
  income: Pence;
  spending: Pence;
  rate: number | null;
  investmentFlows: Pence;
  investmentIncome: Pence;
}
export type SavingsResult = SavingsMetrics | { status: "unavailable"; reason: string };
const incomeTypes = new Set([
  "ORDINARY",
  "BONUS",
  "PROPERTY_INCOME",
  "INTEREST",
  "INTEREST_PAID_BY_US_OBLIGORS",
  "INTEREST_PAID_BY_FOREIGN_CORPORATIONS",
  "DIVIDENDS_PAID_BY_US_CORPORATIONS",
  "DIVIDENDS_PAID_BY_FOREIGN_CORPORATIONS",
  "REAL_PROPERTY_INCOME_AND_NATURAL_RESOURCES_ROYALTIES",
  "DIVIDEND",
  "PROPERTY_INCOME_DISTRIBUTION",
  "TAX_EXEMPTED",
]);
const capitalTypes = new Set([
  "RETURN_OF_CAPITAL_NON_US",
  "DEMERGER",
  "CAPITAL_GAINS_DISTRIBUTION_NON_US",
  "INTERIM_LIQUIDATION",
  "CAPITAL_GAINS",
  "CAPITAL_GAINS_DISTRIBUTION",
  "RETURN_OF_CAPITAL",
  "SHORT_TERM_CAPITAL_GAINS",
  "LONG_TERM_CAPITAL_GAINS",
]);
export function inferSavings(
  previous: Snapshot | null,
  current: Snapshot,
  events: readonly CashEvent[],
  historyComplete: boolean,
): SavingsResult {
  const previousAt = previous ? readingAt(previous) : null;
  const currentAt = readingAt(current);
  if (!previous || !previousAt || !currentAt)
    return {
      status: "unavailable",
      reason: "Two dated balance readings with known account coverage are required.",
    };
  if ([...previous.balances, ...current.balances].some((row) => row.kind === "investment"))
    return {
      status: "unavailable",
      reason:
        "Manually tracked investments have no cash-movement history, so savings and spending cannot be inferred for this interval.",
    };
  const start = Date.parse(previousAt),
    end = Date.parse(currentAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return {
      status: "unavailable",
      reason: "The balance readings do not define a valid interval.",
    };
  if (current.periodIncome === null || current.cashPensionContributions === null)
    return {
      status: "unavailable",
      reason: "Confirm income and pension payments from cash for this interval.",
    };
  if (!historyComplete)
    return {
      status: "unavailable",
      reason: "Trading 212 history for this interval is incomplete.",
    };
  const previousIds = savingsConnectionIds(previous).sort().join(",");
  const currentIds = savingsConnectionIds(current).sort().join(",");
  if (previousIds !== currentIds)
    return {
      status: "unavailable",
      reason: "Connected investment accounts changed between these readings.",
    };
  const cashIds = (snapshot: Snapshot) =>
    snapshot.balances
      .filter((row) => isCashAccount(row.kind))
      .map((row) => row.accountId)
      .sort()
      .join(",");
  const historical = previous.source === "historical" || current.source === "historical";
  const sameCashCoverage = historical
    ? previous.source === "historical" &&
      current.source === "historical" &&
      !!previous.historicalSavings?.cashCoverageId &&
      previous.historicalSavings.cashCoverageId === current.historicalSavings?.cashCoverageId
    : cashIds(previous) === cashIds(current);
  if (!sameCashCoverage)
    return {
      status: "unavailable",
      reason:
        "Cash accounts changed between these readings; their opening or closing balances are not known.",
    };
  let flows = 0,
    income = 0,
    fees = 0;
  for (const event of events) {
    const at = Date.parse(event.occurredAt);
    if (at <= start || at > end) continue;
    if (event.source === "transaction") {
      if (event.type === "DEPOSIT") flows += Math.abs(event.amount);
      else if (event.type === "WITHDRAW") flows -= Math.abs(event.amount);
      else if (event.type === "FEE") fees += Math.abs(event.amount);
      else if (event.type === "INTEREST_ON_FREE_CASH" || event.type === "LENDING_INTEREST")
        income += event.amount;
      else
        return {
          status: "unavailable",
          reason: "A Trading 212 transfer or cash movement cannot be classified reliably.",
        };
    } else {
      const type = event.type.replace(/_MANUFACTURED_PAYMENT$/, "");
      if (incomeTypes.has(type)) income += event.amount;
      else if (!capitalTypes.has(type))
        return {
          status: "unavailable",
          reason: "A Trading 212 distribution cannot be classified reliably.",
        };
    }
  }
  const cashSaved = pence(current.cash - previous.cash);
  const saved = pence(cashSaved + flows + income - fees);
  const totalIncome = pence(current.periodIncome + income);
  return {
    status: "complete",
    start: previousAt,
    end: currentAt,
    cashSaved,
    saved,
    income: totalIncome,
    spending: pence(totalIncome - saved - current.cashPensionContributions),
    rate: totalIncome > 0 ? saved / totalIncome : null,
    investmentFlows: pence(flows),
    investmentIncome: pence(income),
  };
}
