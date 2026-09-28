import { pence, sumMoney } from "@wealth/domain";
import type { Snapshot } from "@wealth/domain";
import type { TimePoint } from "../../components/charts/chartData";

export const assetOptions = [
  { key: "cash", field: "cash", label: "Cash" },
  { key: "investments", field: "investmentTotal", label: "Investments" },
  { key: "pensions", field: "pensions", label: "Pensions" },
] as const;
export type AssetKind = (typeof assetOptions)[number]["key"];
export const allAssets: AssetKind[] = assetOptions.map((asset) => asset.key);
export function selectedAssets(selection: readonly AssetKind[]) {
  return assetOptions.filter((asset) => selection.includes(asset.key));
}
export function selectedNetWorth(
  snapshot: Pick<Snapshot, "cash" | "investmentTotal" | "pensions">,
  selection: readonly AssetKind[],
) {
  return sumMoney(selectedAssets(selection).map((asset) => snapshot[asset.field]));
}
export function filterNetWorthPoints(
  points: readonly TimePoint[],
  selection: readonly AssetKind[],
): TimePoint[] {
  return points.map((point) => ({
    ...point,
    total:
      point.total === null
        ? null
        : sumMoney(selectedAssets(selection).map((asset) => pence(Number(point[asset.key])))),
  }));
}
