import { categoryKey, median, merchantKey, type LedgerEntry } from "./ledgerModel";

const cadences = [
  { id: "weekly", label: "Weekly", days: 7, perYear: 52.18, tolerance: 2, minimum: 4 },
  { id: "fortnightly", label: "Fortnightly", days: 14, perYear: 26.09, tolerance: 2, minimum: 3 },
  { id: "monthly", label: "Monthly", days: 30.44, perYear: 12, tolerance: 5, minimum: 3 },
  { id: "quarterly", label: "Quarterly", days: 91.31, perYear: 4, tolerance: 10, minimum: 3 },
  { id: "annual", label: "Annual", days: 365.25, perYear: 1, tolerance: 20, minimum: 2 },
] as const;
const DAY = 86400000;
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);

export interface RecurringPayment {
  key: string;
  merchant: string;
  categoryId: string;
  direction: "out" | "in";
  cadence: (typeof cadences)[number]["id"];
  cadenceLabel: string;
  amount: number;
  monthly: number;
  annual: number;
  last: string;
  next: string;
  occurrences: { date: string; amount: number }[];
  priceChange: { from: number; to: number } | null;
  status: "active" | "due" | "lapsed";
  started: string;
}

function detect(
  key: string,
  payments: readonly LedgerEntry[],
  asOf: string,
): RecurringPayment | null {
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  const intervals = sorted.slice(1).map((entry, index) => {
    return (time(entry.date) - time(sorted[index]!.date)) / DAY;
  });
  if (!intervals.length) return null;
  const typical = median(intervals);
  const cadence = cadences.find((item) => Math.abs(typical - item.days) <= item.tolerance);
  if (!cadence || sorted.length < cadence.minimum) return null;
  const regular = intervals.filter((gap) => Math.abs(gap - cadence.days) <= cadence.tolerance);
  if (regular.length / intervals.length < 0.75) return null;
  const amounts = sorted.map((entry) => Math.abs(entry.amount));
  const middle = median(amounts);
  // Subscriptions keep a stable price; groceries and fuel don't.
  if (median(amounts.map((amount) => Math.abs(amount - middle))) > middle * 0.15) return null;
  const latest = sorted.at(-1)!;
  const amount = Math.abs(latest.amount);
  const previous = Math.abs(sorted.at(-2)!.amount);
  const next = new Date(time(latest.date) + cadence.days * DAY).toISOString().slice(0, 10);
  const overdue = (time(asOf) - time(next)) / DAY;
  return {
    key,
    merchant: latest.merchant,
    categoryId: categoryKey(latest),
    direction: latest.amount < 0 ? "out" : "in",
    cadence: cadence.id,
    cadenceLabel: cadence.label,
    amount,
    monthly: (amount * cadence.perYear) / 12,
    annual: amount * cadence.perYear,
    last: latest.date,
    next,
    occurrences: sorted.map((entry) => ({ date: entry.date, amount: Math.abs(entry.amount) })),
    priceChange:
      Math.abs(amount - previous) > Math.max(previous * 0.01, 1)
        ? { from: previous, to: amount }
        : null,
    status:
      overdue > Math.max(cadence.tolerance * 2, cadence.days * 0.5)
        ? "lapsed"
        : overdue > -3
          ? "due"
          : "active",
    started: sorted[0]!.date,
  };
}

// Groups by merchant and direction; a merchant mixing a subscription with ad-hoc
// purchases is retried on the payments matching its most common amount.
export function recurringPayments(entries: readonly LedgerEntry[], asOf: string) {
  const groups = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    if (!entry.amount) continue;
    const key = `${entry.amount < 0 ? "out" : "in"}:${merchantKey(entry.merchant)}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const found: RecurringPayment[] = [];
  for (const [key, payments] of groups) {
    const whole = detect(key, payments, asOf);
    if (whole) {
      found.push(whole);
      continue;
    }
    const counts = new Map<number, number>();
    for (const entry of payments) counts.set(entry.amount, (counts.get(entry.amount) ?? 0) + 1);
    const [modal, count] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
    if (count < 2 || count === payments.length) continue;
    const subset = detect(
      `${key}:${modal}`,
      payments.filter((entry) => Math.abs(entry.amount - modal) <= Math.abs(modal) * 0.05),
      asOf,
    );
    if (subset) found.push(subset);
  }
  return found.sort((a, b) => b.monthly - a.monthly);
}
