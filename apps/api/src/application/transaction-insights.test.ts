import { expect, it } from "vitest";
import { transactionInsights } from "./transaction-insights";
import type { StoredEnduteTransaction } from "../storage/endute-transactions";
function row(
  amount: string,
  currency = "GBP",
  categoryId: string | null = "food",
  sandbox = false,
  excluded = false,
) {
  return {
    amount,
    currency,
    booking_date: "2026-09-10",
    sandbox,
    excluded,
    counterparty: "Counterparty",
    enrichment: { merchant_name: "Shop" },
    classification: categoryId ? { categoryId } : null,
    customCategory: categoryId ? "Food" : null,
  } as StoredEnduteTransaction & {
    excluded: boolean;
    customCategory: string | null;
    classification: { categoryId: string | null } | null;
  };
}
it("keeps currencies separate and counts refunds as money in without subtracting them from unrelated purchases", () => {
  const result = transactionInsights([
    row("-0.10"),
    row("-0.20"),
    row("5.00"),
    row("-12.50", "GBP", null),
    row("-10.00", "EUR"),
    row("-999.00", "GBP", "food", true),
    row("-500.00", "GBP", "food", false, true),
    row("-1.123", "KWD"),
  ]);
  const gbp = result.currencies.find((value) => value.currency === "GBP")!;
  expect(gbp.totals).toEqual({ moneyIn: 500, moneyOut: 1280, count: 4 });
  expect(gbp.categories).toEqual([
    { id: "food", name: "Food", moneyOut: 30, count: 2 },
    { id: "uncategorised", name: "Uncategorised", moneyOut: 1250, count: 1 },
  ]);
  expect(gbp.days).toEqual([{ date: "2026-09-10", moneyIn: 500, moneyOut: 1280, count: 4 }]);
  expect(gbp.merchants).toEqual([{ name: "Shop", moneyOut: 1280, count: 3 }]);
  expect(result.currencies.find((value) => value.currency === "EUR")?.totals.moneyOut).toBe(1000);
  expect(result.currencies.find((value) => value.currency === "KWD")?.totals.moneyOut).toBe(112.3);
});
it("falls back to counterparty and keeps unknown merchants visible", () => {
  const first = row("-1");
  first.enrichment.merchant_name = null;
  const second = row("-2");
  second.enrichment.merchant_name = "";
  second.counterparty = null;
  expect(transactionInsights([first, second]).currencies[0]?.merchants).toEqual([
    { name: "Counterparty", moneyOut: 100, count: 1 },
    { name: "Unknown merchant", moneyOut: 200, count: 1 },
  ]);
});
