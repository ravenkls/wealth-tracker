import { formatGbp, monthlyLine, parseGbp, sumMoney } from "@wealth/domain";
import type { Pence } from "@wealth/domain";

export function moneyGroupTotal<T>(rows: T[], value: (row: T) => Pence | null | undefined) {
  const values = rows.map(value);
  if (values.some((amount) => amount === null || amount === undefined)) return "—";
  try {
    return formatGbp(sumMoney(values as Pence[]));
  } catch {
    return "—";
  }
}

export function budgetGroupTotal(rows: { amount: string; frequency: "monthly" | "annual" }[]) {
  try {
    const mixed = new Set(rows.map((row) => row.frequency)).size > 1;
    const total = sumMoney(
      rows.map((row) => {
        const amount = parseGbp(row.amount);
        return mixed
          ? monthlyLine({ ...row, amount, id: "", name: "", destinationId: null })
          : amount;
      }),
    );
    return formatGbp(total) + (mixed || rows[0]?.frequency === "monthly" ? " / month" : " / year");
  } catch {
    return "—";
  }
}
