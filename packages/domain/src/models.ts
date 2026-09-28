import type { ManualAccountKind } from "./account-types";
import type { Month } from "./month";
import type { Pence } from "./money";
import type { PayFrequency } from "./budget-rules";

export interface ManualAccount {
  id: string;
  name: string;
  kind: ManualAccountKind;
  archived: boolean;
  workingBalance?: Pence | null;
  version: number;
}
export interface BudgetLine {
  category?: string | null;
  id: string;
  name: string;
  amount: Pence;
  frequency: "monthly" | "annual";
  destinationId: string | null;
}
export interface BudgetPlan {
  salary: Pence;
  payFrequency: PayFrequency;
  sideIncome: Pence;
  expenses: BudgetLine[];
  savingsAllocations: BudgetLine[];
  emergencyMonths: number | null;
  targetCashShare: number | null;
  aggressiveness: 1 | 2 | 3;
  cashDestinationId: string | null;
  investmentDestinationId: string | null;
  cashGoal: Pence | null;
  endOfYearGoal: Pence | null;
  depositGoal: Pence | null;
  depositInvestmentFraction: number | null;
  depositSavingsFraction: number | null;
  jobStartMonth: Month | null;
}
export interface Position {
  ticker: string;
  name: string;
  quantity: number;
  value: Pence;
}
export interface SavedInvestment {
  connectionId: string;
  name: string;
  accountType: "invest" | "isa";
  total: Pence;
  cash: Pence;
  fetchedAt: string;
  positions: Position[];
}
export interface Snapshot {
  month: Month;
  version: number;
  source: "current" | "historical";
  capturedAt: string | null;
  createdAt: string;
  updatedAt: string;
  balances: { accountId: string; name: string; kind: ManualAccountKind; balance: Pence }[];
  investments: SavedInvestment[];
  cash: Pence;
  investmentTotal: Pence;
  pensions: Pence;
  total: Pence;
  notes: string;
  periodIncome: Pence | null;
  cashPensionContributions: Pence | null;
}
export interface HistoryProgress {
  transactionsNext: string | null;
  dividendsNext: string | null;
  transactionsDone: boolean;
  dividendsDone: boolean;
  startedAt: string;
  completedAt: string | null;
  retryAt: string | null;
  error: string | null;
}
export interface Connection {
  id: string;
  name: string;
  accountType: "invest" | "isa";
  version: number;
  encryptedCredentials: string | null;
  disconnected: boolean;
  valuation: SavedInvestment;
  history: HistoryProgress;
}
export type PublicConnection = Omit<Connection, "encryptedCredentials">;
export interface CashEvent {
  reference: string;
  amount: Pence;
  occurredAt: string;
  type: string;
  source: "transaction" | "dividend";
}

export interface TablePreferences {
  columnOrder: string[];
  rowOrder: string[];
  grouping: string[];
  sorting: { id: string; desc: boolean }[];
}
