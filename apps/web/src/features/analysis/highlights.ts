import { change, shiftMonth, type Analysis, type unusualTransactions } from "./ledgerModel";
import type { RecurringPayment } from "./recurring";

export interface Highlight {
  id: string;
  tone: "good" | "bad" | "neutral";
  title: string;
  detail: string;
}
const percent = (value: number) => `${Math.round(Math.abs(value) * 100)}%`;

export function highlights(
  analysis: Analysis,
  recurring: readonly RecurringPayment[],
  unusual: ReturnType<typeof unusualTransactions>,
  money: (value: number) => string,
): Highlight[] {
  const items: Highlight[] = [];
  const { current, comparison, partial, elapsed } = analysis;
  const versus = partial ? `typical by day ${elapsed}` : "your 3-month average";
  const outChange = comparison ? change(current.moneyOut, comparison.moneyOut) : null;
  if (comparison && outChange !== null && Math.abs(outChange) >= 0.1)
    items.push({
      id: "pace",
      tone: outChange > 0 ? "bad" : "good",
      title: `Spending is ${percent(outChange)} ${outChange > 0 ? "above" : "below"} ${partial ? "your usual pace" : "average"}`,
      detail: `${money(current.moneyOut)} vs ${money(comparison.moneyOut)} ${versus}.`,
    });
  const movers = analysis.categories.filter(
    (category) =>
      category.baseline !== null &&
      Math.abs(category.spent - category.baseline) >= Math.max(2500, category.baseline * 0.25),
  );
  const rise = movers
    .filter((category) => category.spent > category.baseline!)
    .sort((a, b) => b.spent - b.baseline! - (a.spent - a.baseline!))[0];
  const fall = movers
    .filter((category) => category.spent < category.baseline!)
    .sort((a, b) => a.spent - a.baseline! - (b.spent - b.baseline!))[0];
  if (rise)
    items.push({
      id: `rise:${rise.id}`,
      tone: "bad",
      title: rise.baseline
        ? `${rise.name} is up ${percent(rise.change!)}`
        : `New spending on ${rise.name}`,
      detail: `${money(rise.spent)} vs ${money(rise.baseline!)} ${versus}.`,
    });
  if (fall)
    items.push({
      id: `fall:${fall.id}`,
      tone: "good",
      title: `${fall.name} is down ${percent(fall.change!)}`,
      detail: `${money(fall.spent)} vs ${money(fall.baseline!)} ${versus}.`,
    });
  if (current.moneyIn > 0 && !partial) {
    const rate = (current.moneyIn - current.moneyOut) / current.moneyIn;
    items.push({
      id: "rate",
      tone: rate >= 0 ? "good" : "bad",
      title:
        rate >= 0
          ? `You kept ${percent(rate)} of what came in`
          : `You spent ${percent(rate)} more than came in`,
      detail: `${money(current.moneyIn)} in, ${money(current.moneyOut)} out.`,
    });
  }
  const month = analysis.window.month;
  for (const payment of recurring) {
    if (payment.direction !== "out") continue;
    if (payment.priceChange && payment.last.startsWith(month))
      items.push({
        id: `price:${payment.key}`,
        tone: payment.priceChange.to > payment.priceChange.from ? "bad" : "good",
        title: `${payment.merchant} ${payment.priceChange.to > payment.priceChange.from ? "went up" : "went down"}`,
        detail: `${money(payment.priceChange.from)} → ${money(payment.priceChange.to)} ${payment.cadenceLabel.toLowerCase()}, ${money(payment.annual)} a year.`,
      });
    else if (payment.started >= `${shiftMonth(month, -2)}-01` && payment.last.startsWith(month))
      items.push({
        id: `new:${payment.key}`,
        tone: "neutral",
        title: `New regular payment: ${payment.merchant}`,
        detail: `${money(payment.amount)} ${payment.cadenceLabel.toLowerCase()} since ${formatDate(payment.started)}.`,
      });
  }
  const fresh = analysis.merchants.filter((merchant) => merchant.isNew);
  if (fresh.length && analysis.firstDate && analysis.firstDate < `${month}-01`)
    items.push({
      id: "new-merchants",
      tone: "neutral",
      title: `${fresh.length} new ${fresh.length === 1 ? "merchant" : "merchants"} this month`,
      detail: `${money(fresh.reduce((sum, merchant) => sum + merchant.spent, 0))} in total, led by ${fresh[0]!.name}.`,
    });
  if (unusual.length)
    items.push({
      id: "unusual",
      tone: "neutral",
      title: `${unusual.length} unusually large ${unusual.length === 1 ? "payment" : "payments"}`,
      detail: `Largest: ${unusual[0]!.entry.merchant}, ${money(-unusual[0]!.entry.amount)} (typically ${money(unusual[0]!.typical)}).`,
    });
  const lastYear = analysis.lastYear;
  if (lastYear?.moneyOut && !partial) {
    const yearChange = change(current.moneyOut, lastYear.moneyOut)!;
    if (Math.abs(yearChange) >= 0.1)
      items.push({
        id: "year",
        tone: yearChange > 0 ? "bad" : "good",
        title: `${percent(yearChange)} ${yearChange > 0 ? "more" : "less"} than a year ago`,
        detail: `${money(current.moneyOut)} vs ${money(lastYear.moneyOut)} last year.`,
      });
  }
  const uncategorised = current.categories.get("uncategorised") ?? 0;
  if (current.moneyOut && uncategorised / current.moneyOut >= 0.1)
    items.push({
      id: "uncategorised",
      tone: "neutral",
      title: `${percent(uncategorised / current.moneyOut)} of spending is uncategorised`,
      detail: `${money(uncategorised)} — assign categories to sharpen these insights.`,
    });
  return items;
}
export function formatDate(date: string, withYear = false) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}
