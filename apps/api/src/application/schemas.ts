import { z } from "zod";
import { month, pence, payFrequencies, manualAccountKinds } from "@wealth/domain";
export const amount = z.number().int().safe().transform(pence);
export const nonnegative = amount.refine((value) => value >= 0, "Amount cannot be negative.");
export const period = z.string().transform((value, ctx) => {
  try {
    return month(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Use a valid YYYY-MM month." });
    return z.NEVER;
  }
});
export const identifier = z.string().min(1).max(200);
export const expectedVersion = z.number().int().min(0);
export const accountInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(manualAccountKinds),
  archived: z.boolean(),
  workingBalance: amount.nullable().optional(),
  expectedVersion,
});
const line = z.object({
  category: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional()
    .transform((value) => value || null),
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  amount: nonnegative,
  frequency: z.enum(["monthly", "annual"]),
  destinationId: identifier.nullable(),
});
export const budgetInput = z.object({
  expectedVersion,
  plan: z.object({
    salary: nonnegative,
    payFrequency: z.enum(payFrequencies),
    sideIncome: nonnegative,
    expenses: z.array(line).max(200),
    savingsAllocations: z.array(line).max(200),
    emergencyMonths: z.number().finite().min(0).max(120).nullable(),
    targetCashShare: z.number().min(0).max(1).nullable(),
    aggressiveness: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    cashDestinationId: identifier.nullable(),
    investmentDestinationId: identifier.nullable(),
    cashGoal: nonnegative.nullable(),
    endOfYearGoal: nonnegative.nullable(),
    depositGoal: nonnegative.nullable(),
    depositInvestmentFraction: z.number().min(0).max(1).nullable(),
    depositSavingsFraction: z.number().min(0).max(1).nullable(),
    jobStartMonth: period.nullable(),
  }),
});
const baseSnapshot = {
  month: period,
  expectedVersion,
  operationId: z.uuid(),
  notes: z.string().max(2000),
  replaceConfirmed: z.boolean(),
};
export const currentSnapshotInput = z.object({
  ...baseSnapshot,
  balances: z.array(z.object({ accountId: z.uuid(), balance: amount })).max(200),
  periodIncome: nonnegative.nullable(),
  cashPensionContributions: nonnegative.nullable(),
});
export const historicalSnapshotInput = z.object({
  ...baseSnapshot,
  cash: amount,
  investments: amount,
  pensions: amount,
});
export const correctionInput = z.object({
  ...baseSnapshot,
  balances: z.array(z.object({ accountId: z.uuid(), balance: amount })).max(200),
  periodIncome: nonnegative.nullable(),
  cashPensionContributions: nonnegative.nullable(),
});
export const connectionInput = z.object({
  name: z.string().trim().min(1).max(100),
  accountType: z.enum(["invest", "isa"]),
  apiKey: z.string().trim().min(1).max(512),
  apiSecret: z.string().trim().min(1).max(512),
});
export type CurrentSnapshotInput = z.infer<typeof currentSnapshotInput>;
export type HistoricalSnapshotInput = z.infer<typeof historicalSnapshotInput>;
export type CorrectionInput = z.infer<typeof correctionInput>;

export const preferencesInput = z.object({
  id: z.enum(["accounts", "history", "expenses", "allocations", "connections"]),
  expectedVersion,
  preferences: z.object({
    columnOrder: z.array(identifier).max(50),
    rowOrder: z.array(identifier).max(500),
    grouping: z.array(identifier).max(5),
    sorting: z.array(z.object({ id: identifier, desc: z.boolean() })).max(10),
  }),
});
export const inlineCorrectionInput = z.object({
  month: period,
  expectedVersion,
  operationId: z.uuid(),
  change: z.discriminatedUnion("field", [
    z.object({ field: z.literal("notes"), value: z.string().max(2000) }),
    z.object({ field: z.enum(["cash", "investmentTotal", "pensions"]), value: amount }),
    z.object({
      field: z.enum(["periodIncome", "cashPensionContributions"]),
      value: nonnegative.nullable(),
    }),
    z.object({ field: z.literal("balance"), accountId: z.uuid(), value: amount }),
  ]),
});
export type InlineCorrectionInput = z.infer<typeof inlineCorrectionInput>;
