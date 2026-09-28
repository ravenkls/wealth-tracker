import { monthDistance, pence, readingAt } from "@wealth/domain";
import type { Pence, Snapshot } from "@wealth/domain";
import { InputError } from "./snapshot-service";

export function prepareHistoricalSavings(
  snapshots: readonly Snapshot[],
  options: { connectionIds: string[]; cashCoverageId: string; monthlyIncome: Pence },
  now: Date,
): Snapshot[] {
  if (
    !options.cashCoverageId ||
    !options.connectionIds.length ||
    new Set(options.connectionIds).size !== options.connectionIds.length ||
    options.monthlyIncome < 0
  )
    throw new InputError(
      "Declare the historical account coverage and a nonnegative monthly income.",
    );
  const ordered = [...snapshots].sort((a, b) => a.month.localeCompare(b.month));
  if (new Set(ordered.map((snapshot) => snapshot.month)).size !== ordered.length)
    throw new InputError("Historical months must be unique.");
  return ordered.map((snapshot, index) => {
    if (
      snapshot.source !== "historical" ||
      snapshot.historicalSavings ||
      snapshot.capturedAt ||
      snapshot.balances.length ||
      snapshot.investments.length
    )
      throw new InputError("Only unenriched historical totals can use this migration.");
    const previous = ordered[index - 1];
    const next: Snapshot = {
      ...snapshot,
      version: snapshot.version + 1,
      updatedAt: now.toISOString(),
      historicalSavings: {
        readingDate: `${snapshot.month}-01`,
        connectionIds: [...options.connectionIds],
        cashCoverageId: options.cashCoverageId,
        assumedMonthlyIncome: options.monthlyIncome,
      },
      periodIncome: previous
        ? pence(options.monthlyIncome * monthDistance(previous.month, snapshot.month))
        : null,
      cashPensionContributions: pence(0),
    };
    if (!readingAt(next)) throw new InputError("Invalid historical reading date.");
    return next;
  });
}
