import Decimal from "decimal.js";
import type { StoredEnduteTransaction } from "../storage/endute-transactions";

type LedgerSource = StoredEnduteTransaction & {
  excluded: boolean;
  customCategory: string | null;
  classification: { categoryId: string | null } | null;
};
export interface LedgerEntry {
  key: string;
  date: string;
  amount: number;
  currency: string;
  categoryId: string | null;
  category: string | null;
  merchant: string;
  description: string;
  account: string;
}
// Amounts are signed hundredths of a currency unit, including currencies with other display precision.
export function ledgerEntries(rows: readonly LedgerSource[]): LedgerEntry[] {
  return (
    rows
      // Sandbox accounts and user-excluded rows must not inflate a user's financial analysis.
      .filter((row) => !row.sandbox && !row.excluded)
      .map((row) => ({
        key: `${row.accountId}#${row.id}`,
        date: row.booking_date,
        amount: new Decimal(row.amount).times(100).toNumber(),
        currency: row.currency,
        categoryId: row.classification?.categoryId ?? null,
        category: row.customCategory,
        merchant:
          row.enrichment.merchant_name?.trim() || row.counterparty?.trim() || "Unknown merchant",
        description: row.description,
        account: row.accountName,
      }))
  );
}
