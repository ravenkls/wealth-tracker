import type { Month, Pence } from "@wealth/domain";
export interface MonthlyPoint {
  readonly month: Month;
  readonly total: Pence;
}
export interface AccountBalance {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: "cash" | "investments" | "pensions";
  readonly balance: Pence;
  readonly change: Pence;
}
export interface OverviewData {
  readonly month: Month;
  readonly previousMonth: Month;
  readonly accounts: readonly AccountBalance[];
  readonly history: readonly MonthlyPoint[];
  readonly budget: { readonly income: Pence; readonly spending: Pence };
  readonly cashGoal: Pence;
}
