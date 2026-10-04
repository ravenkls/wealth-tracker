import { expect, it } from "vitest";
import { ruleId, ruleMatcher, type TransactionRule } from "./rules";

const row = (merchant: string | null, description: string, counterparty: string | null = null) => ({
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
const rule = (merchant: string, description: string | null, action: TransactionRule["action"]) => ({
  merchant,
  description,
  action,
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
