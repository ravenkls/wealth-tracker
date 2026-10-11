import { describe, expect, it } from "vitest";
import { transactionsCsv, yearChunks, type TransactionRow } from "./transactionExport";

const row = (patch: Partial<TransactionRow>) =>
  ({
    booking_date: "2026-01-02",
    merchant: "Tesco",
    description: "TESCO STORES",
    amount: "-12.50",
    currency: "GBP",
    customCategory: "Groceries",
    accountName: "Current",
    sandbox: false,
    excluded: false,
    ...patch,
  }) as TransactionRow;

describe("transaction export", () => {
  it("splits long ranges into contiguous chunks of at most a year", () => {
    expect(yearChunks("2024-01-01", "2026-03-31")).toEqual([
      { from: "2024-01-01", to: "2024-12-31" },
      { from: "2025-01-01", to: "2026-01-01" },
      { from: "2026-01-02", to: "2026-03-31" },
    ]);
    expect(yearChunks("2026-05-01", "2026-05-01")).toEqual([
      { from: "2026-05-01", to: "2026-05-01" },
    ]);
  });

  it("writes dated rows in order with escaping and formula protection", () => {
    const csv = transactionsCsv([
      row({ booking_date: "2026-02-01", merchant: '=HYPERLINK("x")', excluded: true }),
      row({ description: "Coffee, cake\nand more", customCategory: null, sandbox: true }),
    ]);
    expect(csv.split("\r\n")).toEqual([
      "Date,Merchant,Description,Amount,Currency,Category,Account,Excluded",
      '2026-01-02,Tesco,"Coffee, cake\nand more",-12.50,GBP,,Current (sandbox),no',
      `2026-02-01,"'=HYPERLINK(""x"")",TESCO STORES,-12.50,GBP,Groceries,Current,yes`,
      "",
    ]);
  });
});
