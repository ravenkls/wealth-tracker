import { expect, it } from "vitest";
import { monthlyChart, monthDistance } from "./history";
import { month } from "./month";
import { pence } from "./money";
const values = [
  { month: month("2025-12"), total: pence(10000) },
  { month: month("2026-02"), total: pence(0) },
  { month: month("2026-09"), total: pence(20000) },
];
it("preserves missing months as gaps while retaining real zero balances", () => {
  const result = monthlyChart(values, "All", month("2026-09"));
  expect(result[1]).toEqual({ month: "2026-01", total: null });
  expect(result[2]).toEqual({ month: "2026-02", total: 0 });
  expect(monthDistance(month("2025-12"), month("2026-02"))).toBe(2);
});
it("uses calendar range rather than the last six saved observations", () => {
  const result = monthlyChart(values, "6M", month("2026-09"));
  expect(result).toHaveLength(6);
  expect(result[0]?.month).toBe("2026-04");
  expect(result.filter((point) => point.total !== null)).toHaveLength(1);
});
it("rejects duplicated active monthly records", () => {
  expect(() => monthlyChart([...values, values[0]!], "All", month("2026-09"))).toThrow(
    "one active snapshot",
  );
});
