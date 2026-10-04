import { z } from "zod";
import { hash } from "../auth/tokens";
import type { StoredEnduteTransaction } from "../storage/endute-transactions";

const UNKNOWN = "Unknown merchant";
export const ruleInput = z
  .object({
    merchant: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(500).nullable(),
    action: z.discriminatedUnion("type", [
      z.object({ type: z.literal("category"), categoryId: z.uuid() }),
      z.object({ type: z.literal("exclude") }),
    ]),
  })
  .strict()
  .refine(
    (rule) => rule.description || rule.merchant.toLowerCase() !== UNKNOWN.toLowerCase(),
    "Unknown merchants need a description to match on.",
  );
export type RuleInput = z.infer<typeof ruleInput>;
export interface TransactionRule extends RuleInput {
  createdAt: string;
}

const normalise = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
export function merchantName(row: Pick<StoredEnduteTransaction, "enrichment" | "counterparty">) {
  return row.enrichment.merchant_name?.trim() || row.counterparty?.trim() || UNKNOWN;
}
// Stable per match so re-creating a rule for the same merchant replaces it.
export function ruleId(rule: Pick<RuleInput, "merchant" | "description">) {
  return hash(
    JSON.stringify([normalise(rule.merchant), rule.description && normalise(rule.description)]),
  ).slice(0, 32);
}

// A merchant-and-description rule is more specific, so it beats a merchant-only rule.
export function ruleMatcher(rules: readonly TransactionRule[]) {
  const exact = new Map<string, TransactionRule>();
  const merchants = new Map<string, TransactionRule>();
  for (const rule of rules)
    if (rule.description)
      exact.set(JSON.stringify([normalise(rule.merchant), normalise(rule.description)]), rule);
    else merchants.set(normalise(rule.merchant), rule);
  return (row: Pick<StoredEnduteTransaction, "enrichment" | "counterparty" | "description">) => {
    const merchant = normalise(merchantName(row));
    return (
      exact.get(JSON.stringify([merchant, normalise(row.description)])) ?? merchants.get(merchant)
    );
  };
}
