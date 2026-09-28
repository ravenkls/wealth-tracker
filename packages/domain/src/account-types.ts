export const manualAccountKinds = ["cash", "debt", "investment", "pension"] as const;
export type ManualAccountKind = (typeof manualAccountKinds)[number];

export const accountKindLabels: Record<ManualAccountKind, string> = {
  cash: "Cash",
  debt: "Debt",
  investment: "Investment",
  pension: "Pension",
};

export function isCashAccount(kind: ManualAccountKind) {
  return kind === "cash" || kind === "debt";
}

export function accountAsset(kind: ManualAccountKind): "cash" | "investments" | "pensions" {
  return kind === "investment" ? "investments" : kind === "pension" ? "pensions" : "cash";
}
