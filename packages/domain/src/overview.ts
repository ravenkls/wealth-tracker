export const netWorthAssets = ["cash", "investments", "pensions"] as const;
export type NetWorthAsset = (typeof netWorthAssets)[number];
export interface OverviewSettings {
  netWorthAssets: NetWorthAsset[];
}
