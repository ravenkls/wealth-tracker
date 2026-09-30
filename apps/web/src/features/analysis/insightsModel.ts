import type { api } from "../../lib/api";
export type InsightsPage = Awaited<ReturnType<typeof api.analysis.insights.query>>;
export function monthRange(value: string) {
  const [year, month] = value.split("-").map(Number);
  const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return { from: `${value}-01`, to: `${value}-${last}` };
}
export function mergeInsights(
  pages: readonly InsightsPage[],
  currency: string,
  range: { from: string; to: string },
) {
  const totals = { moneyIn: 0, moneyOut: 0, count: 0 };
  const days = new Map<
    string,
    { date: string; moneyIn: number; moneyOut: number; count: number }
  >();
  const categories = new Map<
    string,
    { id: string; name: string; moneyOut: number; count: number }
  >();
  const merchants = new Map<string, { name: string; moneyOut: number; count: number }>();
  for (const page of pages) {
    const value = page.currencies.find((item) => item.currency === currency);
    if (!value) continue;
    totals.moneyIn += value.totals.moneyIn;
    totals.moneyOut += value.totals.moneyOut;
    totals.count += value.totals.count;
    for (const day of value.days) {
      const current = days.get(day.date) ?? { date: day.date, moneyIn: 0, moneyOut: 0, count: 0 };
      current.moneyIn += day.moneyIn;
      current.moneyOut += day.moneyOut;
      current.count += day.count;
      days.set(day.date, current);
    }
    for (const category of value.categories) {
      const current = categories.get(category.id) ?? { ...category, moneyOut: 0, count: 0 };
      current.name = category.name;
      current.moneyOut += category.moneyOut;
      current.count += category.count;
      categories.set(category.id, current);
    }
    for (const merchant of value.merchants) {
      const key = merchant.name.toLowerCase();
      const current = merchants.get(key) ?? { ...merchant, moneyOut: 0, count: 0 };
      current.moneyOut += merchant.moneyOut;
      current.count += merchant.count;
      merchants.set(key, current);
    }
  }
  const points = [];
  for (
    let date = new Date(`${range.from}T00:00:00Z`);
    date.getTime() <= Date.parse(`${range.to}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const key = date.toISOString().slice(0, 10);
    points.push({
      label: String(date.getUTCDate()),
      detail: date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
      ...(days.get(key) ?? { date: key, moneyIn: 0, moneyOut: 0, count: 0 }),
    });
  }
  return {
    totals,
    points,
    categories: [...categories.values()].sort((a, b) => b.moneyOut - a.moneyOut),
    merchants: [...merchants.values()].sort((a, b) => b.moneyOut - a.moneyOut),
    uncategorised: categories.get("uncategorised")?.moneyOut ?? 0,
  };
}
