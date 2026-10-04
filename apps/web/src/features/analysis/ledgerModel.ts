import type { api } from "../../lib/api";

export type LedgerPage = Awaited<ReturnType<typeof api.analysis.ledger.query>>;
export type LedgerEntry = LedgerPage["entries"][number];
export interface Flow {
  moneyIn: number;
  moneyOut: number;
  count: number;
}
export interface MonthFlow extends Flow {
  month: string;
  categories: Map<string, number>;
}
export const UNCATEGORISED = "uncategorised";

export function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}
export function monthSpan(last: string, count: number) {
  return Array.from({ length: count }, (_, index) => shiftMonth(last, index - count + 1));
}
export function daysInMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0)).getUTCDate();
}
export function monthRange(value: string) {
  return { from: `${value}-01`, to: `${value}-${daysInMonth(value)}` };
}
export const categoryKey = (entry: LedgerEntry) => entry.categoryId ?? UNCATEGORISED;
export const merchantKey = (name: string) => name.trim().toLowerCase();
const emptyFlow = (): Flow => ({ moneyIn: 0, moneyOut: 0, count: 0 });
function addFlow(flow: Flow, amount: number) {
  flow.count++;
  if (amount > 0) flow.moneyIn += amount;
  else flow.moneyOut -= amount;
}
const average = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
export function median(values: readonly number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
// Signed share change against a baseline; null when there's nothing to compare with.
export function change(current: number, baseline: number | null) {
  return baseline ? (current - baseline) / baseline : null;
}

export interface AnalysisWindow {
  month: string;
  months: readonly string[];
  // ISO date the analysis is as of: today for the current month, else the selected month's end.
  asOf: string;
}
export function analysisWindow(month: string, history: number, today: string): AnalysisWindow {
  const end = monthRange(month).to;
  return { month, months: monthSpan(month, history), asOf: today < end ? today : end };
}
// One extra month before the window gives the first month a comparison point.
export function fetchRange(window: AnalysisWindow) {
  return { from: `${shiftMonth(window.months[0]!, -1)}-01`, to: monthRange(window.month).to };
}

export function buildAnalysis(
  allEntries: readonly LedgerEntry[],
  currency: string,
  window: AnalysisWindow,
) {
  const entries = allEntries.filter(
    (entry) => entry.currency === currency && entry.date <= window.asOf,
  );
  const names = new Map<string, string>([[UNCATEGORISED, "Uncategorised"]]);
  const byMonth = new Map<string, MonthFlow>();
  for (const entry of entries) {
    if (entry.categoryId && entry.category) names.set(entry.categoryId, entry.category);
    const key = entry.date.slice(0, 7);
    const flow = byMonth.get(key) ?? { month: key, ...emptyFlow(), categories: new Map() };
    byMonth.set(key, flow);
    addFlow(flow, entry.amount);
    if (entry.amount < 0) {
      const category = categoryKey(entry);
      flow.categories.set(category, (flow.categories.get(category) ?? 0) - entry.amount);
    }
  }
  const monthFlow = (month: string): MonthFlow =>
    byMonth.get(month) ?? { month, ...emptyFlow(), categories: new Map() };
  const months = window.months.map(monthFlow);
  const firstDate = entries.reduce(
    (first, entry) => (entry.date < first ? entry.date : first),
    "9999",
  );
  // Months before the first imported transaction are missing data, not zero spending.
  const covered = (month: string) => month >= firstDate.slice(0, 7);
  const baselineMonths = [1, 2, 3]
    .map((offset) => shiftMonth(window.month, -offset))
    .filter(covered)
    .map(monthFlow);
  const current = monthFlow(window.month);
  const inMonth = entries.filter((entry) => entry.date.startsWith(window.month));
  const day = (date: string) => Number(date.slice(8, 10));
  const elapsed = window.asOf.startsWith(window.month)
    ? day(window.asOf)
    : daysInMonth(window.month);
  const baselineToDate = baselineMonths.map((flow) => {
    const totals = new Map<string, number>();
    for (const entry of entries)
      if (entry.amount < 0 && entry.date.startsWith(flow.month) && day(entry.date) <= elapsed)
        totals.set(categoryKey(entry), (totals.get(categoryKey(entry)) ?? 0) - entry.amount);
    return totals;
  });
  const baselineCategory = (id: string) =>
    baselineToDate.length ? average(baselineToDate.map((totals) => totals.get(id) ?? 0)) : null;
  const cumulative = (flowEntries: readonly LedgerEntry[], month: string) => {
    const length = daysInMonth(month);
    const totals = Array.from({ length: 31 }, () => emptyFlow());
    for (const entry of flowEntries) addFlow(totals[day(entry.date) - 1]!, entry.amount);
    let moneyIn = 0,
      moneyOut = 0;
    return totals.map((flow, index) => {
      if (index < length) {
        moneyIn += flow.moneyIn;
        moneyOut += flow.moneyOut;
      }
      return { ...flow, cumulativeIn: moneyIn, cumulativeOut: moneyOut };
    });
  };
  const currentDays = cumulative(inMonth, window.month);
  const baselineDays = baselineMonths.map((flow) =>
    cumulative(
      entries.filter((entry) => entry.date.startsWith(flow.month)),
      flow.month,
    ),
  );
  const typicalAt = (index: number) =>
    baselineDays.length
      ? {
          moneyIn: average(baselineDays.map((days) => days[index]!.cumulativeIn)),
          moneyOut: average(baselineDays.map((days) => days[index]!.cumulativeOut)),
        }
      : null;
  const days = Array.from({ length: daysInMonth(window.month) }, (_, index) => {
    const date = `${window.month}-${String(index + 1).padStart(2, "0")}`;
    const value = currentDays[index]!;
    const typical = typicalAt(index);
    const future = index >= elapsed;
    return {
      label: String(index + 1),
      detail: new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
      date,
      moneyIn: future ? null : value.moneyIn,
      moneyOut: future ? null : value.moneyOut,
      cumulativeOut: future ? null : value.cumulativeOut,
      typicalOut: typical?.moneyOut ?? null,
    };
  });
  // Partial months compare against a typical month at the same day, complete months against averages.
  const comparison = typicalAt(elapsed - 1);
  const baselineAverage = baselineMonths.length
    ? {
        moneyIn: average(baselineMonths.map((flow) => flow.moneyIn)),
        moneyOut: average(baselineMonths.map((flow) => flow.moneyOut)),
      }
    : null;
  const partial = elapsed < daysInMonth(window.month);

  const finished = (month: string) => covered(month) && monthRange(month).to <= window.asOf;
  // Averages skip a part-finished month unless it's the only one with data.
  const averaged = (month: string) =>
    months.some((flow) => finished(flow.month)) ? finished(month) : covered(month);
  const categoryIds = new Set<string>();
  for (const flow of months) for (const id of flow.categories.keys()) categoryIds.add(id);
  for (const id of current.categories.keys()) categoryIds.add(id);
  const categories = [...categoryIds]
    .map((id) => {
      const series = months.map((flow) => flow.categories.get(id) ?? 0);
      const total = series.reduce((sum, value) => sum + value, 0);
      const settled = series.filter((_, index) => averaged(months[index]!.month));
      const spent = current.categories.get(id) ?? 0;
      const baseline = baselineCategory(id);
      return {
        id,
        name: names.get(id) ?? "Unknown category",
        spent,
        baseline,
        change: change(spent, baseline),
        share: current.moneyOut ? spent / current.moneyOut : 0,
        series,
        total,
        monthlyAverage: average(settled),
        count: inMonth.filter((entry) => entry.amount < 0 && categoryKey(entry) === id).length,
      };
    })
    .sort((a, b) => b.spent - a.spent || b.total - a.total);

  const windowStart = `${window.months[0]}-01`;
  const windowEntries = entries.filter((entry) => entry.date >= windowStart);
  return {
    currency,
    window,
    entries: windowEntries,
    history: entries,
    monthEntries: inMonth,
    months: months.map((flow) => ({
      ...flow,
      covered: covered(flow.month),
      averaged: averaged(flow.month),
    })),
    current,
    elapsed,
    partial,
    baselineMonths: baselineMonths.length,
    comparison: partial ? comparison : baselineAverage,
    baselineAverage,
    lastYear: covered(shiftMonth(window.month, -12))
      ? monthFlow(shiftMonth(window.month, -12))
      : null,
    days,
    categories,
    names,
    merchants: merchantStats(windowEntries, window),
    firstDate: firstDate === "9999" ? null : firstDate,
  };
}
export type Analysis = ReturnType<typeof buildAnalysis>;

export function merchantStats(entries: readonly LedgerEntry[], window: AnalysisWindow) {
  const merchants = new Map<
    string,
    {
      key: string;
      name: string;
      total: number;
      spent: number;
      count: number;
      monthCount: number;
      first: string;
      last: string;
      series: number[];
      categories: Map<string, number>;
    }
  >();
  const index = new Map(window.months.map((month, position) => [month, position]));
  for (const entry of entries) {
    if (entry.amount >= 0) continue;
    const key = merchantKey(entry.merchant);
    const merchant = merchants.get(key) ?? {
      key,
      name: entry.merchant,
      total: 0,
      spent: 0,
      count: 0,
      monthCount: 0,
      first: entry.date,
      last: entry.date,
      series: window.months.map(() => 0),
      categories: new Map(),
    };
    merchants.set(key, merchant);
    merchant.total -= entry.amount;
    merchant.count++;
    if (entry.date < merchant.first) merchant.first = entry.date;
    if (entry.date > merchant.last) {
      merchant.last = entry.date;
      merchant.name = entry.merchant;
    }
    const position = index.get(entry.date.slice(0, 7));
    if (position !== undefined) merchant.series[position]! -= entry.amount;
    if (entry.date.startsWith(window.month)) merchant.spent -= entry.amount;
    const category = categoryKey(entry);
    merchant.categories.set(category, (merchant.categories.get(category) ?? 0) + 1);
  }
  return [...merchants.values()]
    .map(({ categories, ...merchant }) => ({
      ...merchant,
      monthCount: merchant.series.filter(Boolean).length,
      average: merchant.total / merchant.count,
      categoryId: [...categories].sort((a, b) => b[1] - a[1])[0]![0],
      isNew: merchant.first.startsWith(window.month),
    }))
    .sort((a, b) => b.total - a.total);
}
export type MerchantStat = ReturnType<typeof merchantStats>[number];

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const sizeBands = [500, 2000, 5000, 10000, 25000, 50000, Infinity];
export function spendingPatterns(analysis: Analysis) {
  const outgoings = analysis.entries.filter((entry) => entry.amount < 0);
  const start = analysis.firstDate && analysis.firstDate > `${analysis.window.months[0]}-01`;
  const from = Date.parse(
    `${start ? analysis.firstDate : `${analysis.window.months[0]}-01`}T00:00:00Z`,
  );
  const to = Date.parse(`${analysis.window.asOf}T00:00:00Z`);
  const weekdayCounts = Array.from({ length: 7 }, () => 0);
  for (let time = from; time <= to; time += 86400000)
    weekdayCounts[(new Date(time).getUTCDay() + 6) % 7]!++;
  const weekdayTotals = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  const monthDays = Array.from({ length: 31 }, () => 0);
  const bands = sizeBands.map((limit) => ({ limit, count: 0, total: 0 }));
  for (const entry of outgoings) {
    const date = new Date(`${entry.date}T00:00:00Z`);
    const weekday = weekdayTotals[(date.getUTCDay() + 6) % 7]!;
    weekday.total -= entry.amount;
    weekday.count++;
    monthDays[date.getUTCDate() - 1]! -= entry.amount;
    const band = bands.find((item) => -entry.amount < item.limit)!;
    band.count++;
    band.total -= entry.amount;
  }
  const coveredMonths = Math.max(1, analysis.months.filter((month) => month.covered).length);
  return {
    weekdays: weekdays.map((label, index) => ({
      label,
      detail: `Average ${label}`,
      average: weekdayCounts[index] ? weekdayTotals[index]!.total / weekdayCounts[index]! : 0,
      count: weekdayTotals[index]!.count,
    })),
    monthDays: monthDays.map((total, index) => ({
      label: String(index + 1),
      detail: `Day ${index + 1} of the month`,
      average: total / coveredMonths,
    })),
    bands: bands.map((band, index) => ({ ...band, from: sizeBands[index - 1] ?? 0 })),
  };
}

// Unusually large outgoings for their category, using median absolute deviation.
export function unusualTransactions(analysis: Analysis) {
  const byCategory = new Map<string, number[]>();
  for (const entry of analysis.entries)
    if (entry.amount < 0)
      byCategory.set(categoryKey(entry), [
        ...(byCategory.get(categoryKey(entry)) ?? []),
        -entry.amount,
      ]);
  const limits = new Map(
    [...byCategory].map(([id, values]) => {
      const middle = median(values);
      const spread = median(values.map((value) => Math.abs(value - middle)));
      return [id, { middle, limit: Math.max(middle * 2.5, middle + spread * 5, 2500) }];
    }),
  );
  return analysis.monthEntries
    .filter((entry) => {
      const stats = limits.get(categoryKey(entry));
      return (
        entry.amount < 0 &&
        !!stats &&
        (byCategory.get(categoryKey(entry))?.length ?? 0) >= 5 &&
        -entry.amount > stats.limit
      );
    })
    .map((entry) => ({ entry, typical: limits.get(categoryKey(entry))!.middle }))
    .sort((a, b) => a.entry.amount - b.entry.amount);
}
