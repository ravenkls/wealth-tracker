import { expect, it } from "vitest";
import { mergeInsights, monthRange, type InsightsPage } from "./insightsModel";
import { chartMoney, compactMoney } from "../../components/charts/ChartFrame";
const page = (moneyOut: number, count: number, merchant = "Shop"): InsightsPage => ({
  nextCursor: null,
  currencies: [
    {
      currency: "GBP",
      totals: { moneyIn: 0, moneyOut, count },
      days: [{ date: "2024-02-02", moneyIn: 0, moneyOut, count }],
      categories: [{ id: "uncategorised", name: "Uncategorised", moneyOut, count }],
      merchants: [{ name: merchant, moneyOut, count }],
    },
  ],
});
it("combines every insights page, fills missing days and merges merchants regardless of case", () => {
  const result = mergeInsights(
    [page(1000, 2), page(2000, 3, "SHOP")],
    "GBP",
    monthRange("2024-02"),
  );
  expect(result.totals).toEqual({ moneyIn: 0, moneyOut: 3000, count: 5 });
  expect(result.uncategorised).toBe(3000);
  expect(result.merchants).toEqual([{ name: "Shop", moneyOut: 3000, count: 5 }]);
  expect(result.points).toHaveLength(29);
  expect(result.points[1]?.moneyOut).toBe(3000);
  expect(result.points[0]?.moneyOut).toBe(0);
  expect(mergeInsights([page(1000, 2)], "EUR", monthRange("2024-02")).totals.count).toBe(0);
});
it("uses calendar month boundaries and each currency's display precision", () => {
  expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  expect(monthRange("2026-02").to).toBe("2026-02-28");
  expect(mergeInsights([], "GBP", monthRange("9999-12")).points).toHaveLength(31);
  expect(chartMoney(112.3, "KWD")).toContain("1.123");
  expect(chartMoney(120000, "JPY")).toContain("1,200");
  expect(chartMoney(1000, "EUR")).toContain("€10.00");
  expect(compactMoney(120000)).toContain("£");
});
