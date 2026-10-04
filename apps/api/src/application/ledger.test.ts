import { expect, it } from "vitest";
import { ledgerEntries } from "./ledger";
import type { StoredEnduteTransaction } from "../storage/endute-transactions";
function row(
  amount: string,
  currency = "GBP",
  categoryId: string | null = "food",
  sandbox = false,
  excluded = false,
) {
  return {
    id: `id${amount}`,
    accountId: "account",
    accountName: "Current",
    amount,
    currency,
    booking_date: "2026-09-10",
    description: "CARD PAYMENT",
    sandbox,
    excluded,
    counterparty: "Counterparty",
    enrichment: { merchant_name: "Shop" },
    classification: categoryId ? { categoryId, version: 2 } : null,
    customCategory: categoryId ? "Food" : null,
    categorisationStatus: categoryId ? "manual" : "pending",
  } as StoredEnduteTransaction & {
    excluded: boolean;
    customCategory: string | null;
    classification: { categoryId: string | null; version: number } | null;
    categorisationStatus: string;
  };
}
it("drops sandbox and excluded rows and converts amounts to signed hundredths", () => {
  const entries = ledgerEntries([
    row("-0.10"),
    row("5.00", "GBP", null),
    row("-999.00", "GBP", "food", true),
    row("-500.00", "GBP", "food", false, true),
    row("-1.123", "KWD"),
  ]);
  expect(entries).toEqual([
    {
      key: "account#id-0.10",
      accountId: "account",
      id: "id-0.10",
      version: 2,
      status: "manual",
      date: "2026-09-10",
      amount: -10,
      currency: "GBP",
      categoryId: "food",
      category: "Food",
      merchant: "Shop",
      description: "CARD PAYMENT",
      account: "Current",
    },
    expect.objectContaining({ amount: 500, categoryId: null, category: null }),
    expect.objectContaining({ amount: -112.3, currency: "KWD" }),
  ]);
});
it("falls back to counterparty and keeps unknown merchants visible", () => {
  const first = row("-1");
  first.enrichment.merchant_name = null;
  const second = row("-2");
  second.enrichment.merchant_name = " ";
  second.counterparty = null;
  expect(ledgerEntries([first, second]).map((entry) => entry.merchant)).toEqual([
    "Counterparty",
    "Unknown merchant",
  ]);
});
