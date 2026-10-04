import { z } from "zod";
import { hash } from "../auth/tokens";
import type { StoredEnduteTransaction } from "../storage/endute-transactions";

const UNKNOWN = "Unknown merchant";
export const ruleInput = z
  .object({
    merchant: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(500).nullable(),
    direction: z.enum(["any", "in", "out"]).default("any"),
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
export type RuleDirection = RuleInput["direction"];
// Rules saved before directions existed have none and apply to both.
export interface TransactionRule extends Omit<RuleInput, "direction"> {
  direction?: RuleDirection;
  createdAt: string;
}

const normalise = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
export function merchantName(row: Pick<StoredEnduteTransaction, "enrichment" | "counterparty">) {
  return row.enrichment.merchant_name?.trim() || row.counterparty?.trim() || UNKNOWN;
}
// Stable per match so re-creating a rule for the same merchant replaces it.
// "any" is left out of the key so rules saved before directions keep their IDs.
export function ruleId(rule: Pick<TransactionRule, "merchant" | "description" | "direction">) {
  const key = [normalise(rule.merchant), rule.description && normalise(rule.description)];
  return hash(
    JSON.stringify(rule.direction && rule.direction !== "any" ? [...key, rule.direction] : key),
  ).slice(0, 32);
}

// Most specific wins: description beats merchant-only, then a matching direction beats "any".
export function ruleMatcher(rules: readonly TransactionRule[]) {
  const key = (merchant: string, description: string | null, direction: RuleDirection) =>
    JSON.stringify([merchant, description, direction]);
  const byKey = new Map(
    rules.map((rule) => [
      key(
        normalise(rule.merchant),
        rule.description && normalise(rule.description),
        rule.direction ?? "any",
      ),
      rule,
    ]),
  );
  return (
    row: Pick<StoredEnduteTransaction, "enrichment" | "counterparty" | "description" | "amount">,
  ) => {
    const merchant = normalise(merchantName(row));
    const description = normalise(row.description);
    const amount = Number(row.amount);
    const direction = amount > 0 ? "in" : amount < 0 ? "out" : null;
    for (const candidate of [description, null])
      for (const side of [direction, "any"] as const) {
        if (!side) continue;
        const rule = byKey.get(key(merchant, candidate, side));
        if (rule) return rule;
      }
    return undefined;
  };
}
