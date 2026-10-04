import { expect, it } from "vitest";
import { ruleId, ruleMatcher, type TransactionRule } from "./rules";

const row = (
  merchant: string | null,
  description: string,
  counterparty: string | null = null,
  amount = "-1.00",
) => ({
  amount,
  enrichment: {
    merchant_name: merchant,
    category: null,
    brand_domain: null,
    confidence: null,
    source: null,
  },
  counterparty,
  description,
});
const rule = (
  merchant: string,
  description: string | null,
  action: TransactionRule["action"],
  direction?: TransactionRule["direction"],
) => ({
  merchant,
  description,
  action,
  ...(direction ? { direction } : {}),
  createdAt: "2026-10-04T00:00:00Z",
});

it("matches case- and spacing-insensitively, preferring merchant-and-description rules", () => {
  const match = ruleMatcher([
    rule("Tesco", null, { type: "category", categoryId: "food" }),
    rule("TESCO", "card payment  to tesco petrol", { type: "exclude" }),
  ]);
  expect(match(row("tesco ", "CARD PAYMENT TO TESCO"))?.action).toEqual({
    type: "category",
    categoryId: "food",
  });
  expect(match(row("Tesco", "Card payment to Tesco petrol"))?.action.type).toBe("exclude");
  expect(match(row(null, "anything", "Tesco"))?.action.type).toBe("category");
  expect(match(row("Sainsbury's", "CARD PAYMENT TO TESCO"))).toBeUndefined();
});

it("gives the same id to rules with the same match so saving again replaces", () => {
  expect(ruleId({ merchant: " Tesco", description: null })).toBe(
    ruleId({ merchant: "tesco", description: null }),
  );
  expect(ruleId({ merchant: "Tesco", description: "A" })).not.toBe(
    ruleId({ merchant: "Tesco", description: null }),
  );
  expect(ruleId({ merchant: "Tesco", description: null })).toMatch(/^[0-9a-f]{32}$/);
});

it("applies direction-specific rules only to money in or out, ahead of rules for either", () => {
  const match = ruleMatcher([
    rule("Alex", null, { type: "category", categoryId: "debt" }, "out"),
    rule("Alex", null, { type: "category", categoryId: "income" }, "in"),
    rule("Monzo Flex", null, { type: "exclude" }, "in"),
    rule("Shop", null, { type: "category", categoryId: "any" }),
    rule("Shop", null, { type: "category", categoryId: "refund" }, "in"),
  ]);
  const category = (value: ReturnType<typeof match>) =>
    value?.action.type === "category" ? value.action.categoryId : value?.action.type;
  expect(category(match(row("Alex", "TRANSFER", null, "-20.00")))).toBe("debt");
  expect(category(match(row("Alex", "TRANSFER", null, "20.00")))).toBe("income");
  expect(category(match(row("Monzo Flex", "REPAYMENT", null, "50.00")))).toBe("exclude");
  expect(match(row("Monzo Flex", "PURCHASE", null, "-50.00"))).toBeUndefined();
  expect(category(match(row("Shop", "SALE", null, "-5.00")))).toBe("any");
  expect(category(match(row("Shop", "REFUND", null, "5.00")))).toBe("refund");
});

it("keeps rule IDs saved before directions and separates rules by direction", () => {
  const legacy = ruleId({ merchant: "Alex", description: null });
  expect(ruleId({ merchant: "Alex", description: null, direction: "any" })).toBe(legacy);
  const out = ruleId({ merchant: "Alex", description: null, direction: "out" });
  expect(
    new Set([legacy, out, ruleId({ merchant: "Alex", description: null, direction: "in" })]).size,
  ).toBe(3);
});
