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
  automation?: { provider: "monzo"; connectionId: string; externalId: string };
  version: number;
}
export interface BudgetLine {
  essential?: boolean;
  category?: string | null;
  id: string;
  name: string;
  amount: Pence;
  frequency: "monthly" | "annual";
  destinationId: string | null;
}
export interface ForecastAssumptions {
  spendingLow: Pence;
  spendingUsual: Pence;
  spendingHigh: Pence;
  annualGrowth: number;
  annualVolatility: number;
}
export interface BudgetPlan {
  forecastAssumptions?: ForecastAssumptions;
  emergencyAccountIds?: string[];
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
  historicalSavings?: {
    readingDate: string;
    connectionIds: string[];
    cashCoverageId: string;
    assumedMonthlyIncome: Pence | null;
  };
  createdAt: string;
  updatedAt: string;
  balances: {
    accountId: string;
    name: string;
    kind: ManualAccountKind;
    balance: Pence;
    automation?: { provider: "monzo"; connectionId: string; externalId: string; fetchedAt: string };
  }[];
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
export type ConnectionDisplayMode = "account" | "holdings";
export interface Connection {
  displayMode?: ConnectionDisplayMode;
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
export interface BankBalance {
  id: string;
  parentAccountId: string;
  name: string;
  type: "account" | "pot";
  kind?: "cash" | "debt";
  balance: Pence;
}
export interface BankConnection {
  id: string;
  provider: "monzo";
  version: number;
  encryptedCredentials: string | null;
  disconnected: boolean;
  status: "awaiting-approval" | "ready" | "reconnect";
  valuation: { balances: BankBalance[]; fetchedAt: string } | null;
  error: string | null;
  leaseUntil: number;
  refreshInFlight: boolean;
}
export type PublicBankConnection = Pick<
  BankConnection,
  "id" | "provider" | "version" | "status" | "valuation" | "error"
>;
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
