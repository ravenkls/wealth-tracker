import { expect, it } from "vitest";
import { pence } from "@wealth/domain";
import { allAssets, filterNetWorthPoints, selectedNetWorth } from "./assetSelection";

it("excludes pensions from both readings without losing debts or altering stored balances", () => {
  const current = { cash: pence(-50000), investmentTotal: pence(200000), pensions: pence(400000) };
  const previous = { ...current, investmentTotal: pence(150000), pensions: pence(300000) };
  expect(selectedNetWorth(current, allAssets)).toBe(550000);
  expect(selectedNetWorth(current, ["cash", "investments"])).toBe(150000);
  expect(
    selectedNetWorth(current, ["cash", "investments"]) -
      selectedNetWorth(previous, ["cash", "investments"]),
  ).toBe(50000);
  expect(selectedNetWorth(current, ["cash"])).toBe(-50000);
  expect(current.pensions).toBe(400000);
});
it("recalculates the total line while retaining missing months and real zero values", () => {
  const points = [
    { label: "2026-07", detail: "July", cash: -100, investments: 100, pensions: 500, total: 500 },
    {
      label: "2026-08",
      detail: "August",
      cash: null,
      investments: null,
      pensions: null,
      total: null,
    },
  ];
  const result = filterNetWorthPoints(points, ["cash", "investments"]);
  expect(result[0]?.total).toBe(0);
  expect(result[1]?.total).toBeNull();
  expect(points[0]?.total).toBe(500);
  expect(filterNetWorthPoints(points, ["pensions"])[0]?.total).toBe(500);
});
