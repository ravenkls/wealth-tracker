import Decimal from "decimal.js";
import type { StoredEnduteTransaction } from "../storage/endute-transactions";

type InsightTransaction = StoredEnduteTransaction & {
  excluded: boolean;
  customCategory: string | null;
  classification: { categoryId: string | null } | null;
};
export interface FlowBucket {
  moneyIn: number;
  moneyOut: number;
  count: number;
}
export interface TransactionInsights {
  currencies: {
    currency: string;
    totals: FlowBucket;
    days: (FlowBucket & { date: string })[];
    categories: { id: string; name: string; moneyOut: number; count: number }[];
    merchants: { name: string; moneyOut: number; count: number }[];
  }[];
}
// Chart values use hundredths of a currency unit, including currencies with other display precision.
export function transactionInsights(rows: readonly InsightTransaction[]): TransactionInsights {
  const currencies = new Map<
    string,
    {
      totals: FlowBucket;
      days: Map<string, FlowBucket>;
      categories: Map<string, { id: string; name: string; moneyOut: number; count: number }>;
      merchants: Map<string, { name: string; moneyOut: number; count: number }>;
    }
  >();
  const empty = (): FlowBucket => ({ moneyIn: 0, moneyOut: 0, count: 0 });
  const add = (a: number, b: number) => new Decimal(a).plus(b).toNumber();
  for (const row of rows) {
    // Sandbox accounts and user-excluded rows must not inflate a user's financial analysis.
    if (row.sandbox || row.excluded) continue;
    let currency = currencies.get(row.currency);
    if (!currency) {
      currency = { totals: empty(), days: new Map(), categories: new Map(), merchants: new Map() };
      currencies.set(row.currency, currency);
    }
    const amount = new Decimal(row.amount).times(100).toNumber();
    const day = currency.days.get(row.booking_date) ?? empty();
    currency.days.set(row.booking_date, day);
    for (const bucket of [currency.totals, day]) {
      bucket.count++;
      if (amount > 0) bucket.moneyIn = add(bucket.moneyIn, amount);
      else bucket.moneyOut = add(bucket.moneyOut, -amount);
    }
    if (amount >= 0) continue;
    const categoryId = row.classification?.categoryId ?? "uncategorised";
    const category = currency.categories.get(categoryId) ?? {
      id: categoryId,
      name: row.customCategory ?? "Uncategorised",
      moneyOut: 0,
      count: 0,
    };
    category.moneyOut = add(category.moneyOut, -amount);
    category.count++;
    currency.categories.set(categoryId, category);
    const name =
      row.enrichment.merchant_name?.trim() || row.counterparty?.trim() || "Unknown merchant";
    const merchant = currency.merchants.get(name) ?? { name, moneyOut: 0, count: 0 };
    merchant.moneyOut = add(merchant.moneyOut, -amount);
    merchant.count++;
    currency.merchants.set(name, merchant);
  }
  return {
    currencies: [...currencies].map(([currency, value]) => ({
      currency,
      totals: value.totals,
      days: [...value.days].map(([date, bucket]) => ({ date, ...bucket })),
      categories: [...value.categories.values()],
      merchants: [...value.merchants.values()],
    })),
  };
}
