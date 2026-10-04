import { describe, expect, it } from "vitest";
import {
  analysisWindow,
  buildAnalysis,
  fetchRange,
  monthSpan,
  shiftMonth,
  spendingPatterns,
  unusualTransactions,
  type LedgerEntry,
} from "./ledgerModel";
import { recurringPayments } from "./recurring";
import { highlights } from "./highlights";

let sequence = 0;
function entry(date: string, amount: number, patch: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    key: `k${sequence}`,
    accountId: "account",
    id: `id${sequence++}`,
    version: 0,
    status: "complete",
    date,
    amount,
    currency: "GBP",
    categoryId: "food",
    category: "Food",
    merchant: "Shop",
    description: "CARD",
    account: "Current",
    ...patch,
  };
}

describe("months", () => {
  it("shifts across year boundaries and spans windows ending at a month", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-11", 3)).toBe("2026-02");
    expect(monthSpan("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
  it("analyses as of today inside the current month and fetches one extra month", () => {
    const window = analysisWindow("2026-10", 6, "2026-10-04");
    expect(window.asOf).toBe("2026-10-04");
    expect(analysisWindow("2026-09", 6, "2026-10-04").asOf).toBe("2026-09-30");
    expect(fetchRange(window)).toEqual({ from: "2026-04-01", to: "2026-10-31" });
  });
});

describe("buildAnalysis", () => {
  const window = analysisWindow("2026-09", 6, "2026-10-04");
  it("totals months, ignores other currencies and treats pre-import months as uncovered", () => {
    const result = buildAnalysis(
      [
        entry("2026-07-02", -1000),
        entry("2026-08-02", -3000),
        entry("2026-09-02", -6000),
        entry("2026-09-25", 200000, { categoryId: null, category: null }),
        entry("2026-09-03", -9999, { currency: "EUR" }),
      ],
      "GBP",
      window,
    );
    expect(result.current).toMatchObject({ moneyIn: 200000, moneyOut: 6000, count: 2 });
    expect(result.months.map((month) => month.covered)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(result.baselineMonths).toBe(2);
    expect(result.comparison).toEqual({ moneyIn: 0, moneyOut: 2000 });
    expect(result.categories[0]).toMatchObject({
      id: "food",
      spent: 6000,
      baseline: 2000,
      change: 2,
      monthlyAverage: 10000 / 3,
    });
  });
  it("compares a partial month against the same point of earlier months", () => {
    const result = buildAnalysis(
      [
        entry("2026-09-03", -1000),
        entry("2026-09-20", -5000),
        entry("2026-10-02", -1500),
        entry("2026-10-03", 99, { categoryId: null }),
      ],
      "GBP",
      analysisWindow("2026-10", 3, "2026-10-04"),
    );
    expect(result.partial).toBe(true);
    expect(result.elapsed).toBe(4);
    expect(result.comparison?.moneyOut).toBe(1000);
    expect(result.categories.find((category) => category.id === "food")?.baseline).toBe(1000);
    expect(result.days[3]).toMatchObject({ cumulativeOut: 1500, typicalOut: 1000 });
    expect(result.days[10]).toMatchObject({ cumulativeOut: null, typicalOut: 1000 });
  });
  it("tracks merchants, flagging first-time merchants in the selected month", () => {
    const result = buildAnalysis(
      [
        entry("2026-08-01", -500, { merchant: "Cafe" }),
        entry("2026-09-01", -700, { merchant: "cafe " }),
        entry("2026-09-02", -2000, { merchant: "Bakery" }),
      ],
      "GBP",
      window,
    );
    expect(
      result.merchants.map(({ name, total, isNew, monthCount }) => [
        name,
        total,
        isNew,
        monthCount,
      ]),
    ).toEqual([
      ["Bakery", 2000, true, 1],
      ["cafe ", 1200, false, 2],
    ]);
  });
});

describe("patterns and anomalies", () => {
  it("averages weekday spend over elapsed days and flags outsized payments", () => {
    const entries = [
      ...["01", "02", "03", "04", "05", "06", "07", "08"].map((day) =>
        entry(`2026-09-${day}`, -1000),
      ),
      entry("2026-09-09", -20000, { merchant: "Big" }),
    ];
    const analysis = buildAnalysis(entries, "GBP", analysisWindow("2026-09", 1, "2026-10-04"));
    const patterns = spendingPatterns(analysis);
    expect(patterns.weekdays[1]).toMatchObject({ label: "Tue", count: 2, average: 400 });
    expect(patterns.bands.find((band) => band.count === 8)?.limit).toBe(2000);
    const unusual = unusualTransactions(analysis);
    expect(unusual.map((item) => item.entry.merchant)).toEqual(["Big"]);
    expect(unusual[0]!.typical).toBe(1000);
  });
});

describe("recurringPayments", () => {
  it("detects monthly subscriptions, price changes and lapsed payments", () => {
    const found = recurringPayments(
      [
        entry("2026-06-05", -1099, { merchant: "Netflix" }),
        entry("2026-07-05", -1099, { merchant: "Netflix" }),
        entry("2026-08-05", -1099, { merchant: "Netflix" }),
        entry("2026-09-05", -1299, { merchant: "Netflix" }),
        entry("2026-03-01", -900, { merchant: "Gym" }),
        entry("2026-04-01", -900, { merchant: "Gym" }),
        entry("2026-05-01", -900, { merchant: "Gym" }),
        entry("2026-09-02", -4321, { merchant: "Tesco" }),
        entry("2026-09-09", -1234, { merchant: "Tesco" }),
        entry("2026-09-16", -9876, { merchant: "Tesco" }),
        entry("2026-09-23", -555, { merchant: "Tesco" }),
      ],
      "2026-09-20",
    );
    expect(found.map((payment) => [payment.merchant, payment.cadence, payment.status])).toEqual([
      ["Netflix", "monthly", "active"],
      ["Gym", "monthly", "lapsed"],
    ]);
    expect(found[0]!.priceChange).toEqual({ from: 1099, to: 1299 });
    expect(found[0]!.next).toBe("2026-10-05");
  });
  it("finds a subscription hidden among ad-hoc purchases at the same merchant", () => {
    const prime = ["2026-06-10", "2026-07-10", "2026-08-10", "2026-09-10"].map((date) =>
      entry(date, -899, { merchant: "Amazon" }),
    );
    const shopping = [
      entry("2026-06-14", -2500, { merchant: "Amazon" }),
      entry("2026-07-02", -1299, { merchant: "Amazon" }),
      entry("2026-08-21", -4550, { merchant: "Amazon" }),
    ];
    const [found] = recurringPayments([...prime, ...shopping], "2026-09-20");
    expect(found).toMatchObject({ merchant: "Amazon", amount: 899, cadence: "monthly" });
  });
  it("detects regular income separately from spending", () => {
    const salary = ["2026-07-25", "2026-08-25", "2026-09-25"].map((date) =>
      entry(date, 250000, { merchant: "Employer" }),
    );
    expect(recurringPayments(salary, "2026-09-30")[0]).toMatchObject({
      direction: "in",
      monthly: 250000,
    });
  });
});

describe("highlights", () => {
  it("summarises spending against usual and category movers", () => {
    const analysis = buildAnalysis(
      [
        entry("2026-08-02", -10000),
        entry("2026-09-02", -20000),
        entry("2026-09-25", 50000, { categoryId: null, category: null }),
      ],
      "GBP",
      analysisWindow("2026-09", 3, "2026-10-04"),
    );
    const titles = highlights(analysis, [], [], (value) => `£${value / 100}`).map(
      (item) => item.title,
    );
    expect(titles).toEqual([
      "Spending is 100% above average",
      "Food is up 100%",
      "You kept 60% of what came in",
    ]);
  });
});
