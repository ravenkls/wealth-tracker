import { expect, it } from "vitest";
import {
  pence,
  type PublicConnection,
  type PublicBankConnection,
  type ManualAccount,
} from "@wealth/domain";
import { bankRows, tradingRows } from "./connectionRows";

const connection: PublicConnection = {
  id: "isa",
  name: "Stocks ISA",
  accountType: "isa",
  version: 1,
  disconnected: false,
  valuation: {
    connectionId: "isa",
    name: "Stocks ISA",
    accountType: "isa",
    total: pence(12500),
    cash: pence(2500),
    fetchedAt: "2026-09-28T12:00:00Z",
    positions: [{ ticker: "ABC", name: "Example holding", quantity: 2, value: pence(10000) }],
  },
  history: {
    transactionsNext: null,
    dividendsNext: null,
    transactionsDone: true,
    dividendsDone: true,
    startedAt: "2026-09-28T12:00:00Z",
    completedAt: "2026-09-28T12:00:00Z",
    retryAt: null,
    error: null,
  },
};
it("keeps existing connections as one row and replaces the total with holdings plus cash when selected", () => {
  expect(tradingRows(connection).map((row) => row.total)).toEqual([12500]);
  const rows = tradingRows({ ...connection, displayMode: "holdings" });
  expect(rows.map((row) => [row.name, row.total])).toEqual([
    ["Example holding", 10000],
    ["Uninvested cash", 2500],
  ]);
  expect(rows.reduce((sum, row) => sum + row.total!, 0)).toBe(connection.valuation.total);
  expect(rows.every((row) => row.type === "Stocks ISA" && row.trading?.id === connection.id)).toBe(
    true,
  );
  const other = tradingRows({ ...connection, id: "second", displayMode: "holdings" });
  expect(new Set([...rows, ...other].map((row) => row.id)).size).toBe(4);
});
it("keeps zero cash visible and reconciles provider differences without attributing them to a holding", () => {
  const rows = tradingRows({
    ...connection,
    displayMode: "holdings",
    valuation: { ...connection.valuation, total: pence(9999), cash: pence(0) },
  });
  expect(rows.map((row) => [row.name, row.total])).toEqual([
    ["Example holding", 10000],
    ["Uninvested cash", 0],
    ["Other account value", -1],
  ]);
  expect(rows.reduce((sum, row) => sum + row.total!, 0)).toBe(9999);
  expect(
    tradingRows({
      ...connection,
      displayMode: "holdings",
      valuation: { ...connection.valuation, positions: [], total: pence(0), cash: pence(0) },
    }),
  ).toHaveLength(1);
});
it("keeps Monzo manageable without tracked balances and avoids an extra total row once balances are selected", () => {
  const bank: PublicBankConnection = {
    id: "monzo",
    provider: "monzo",
    version: 1,
    status: "awaiting-approval",
    valuation: null,
    error: null,
  };
  expect(bankRows([bank], [])).toMatchObject([
    { name: "Monzo", bankId: "monzo", total: null, detail: "Approve access in the Monzo app" },
  ]);
  const account: ManualAccount = {
    id: "account",
    name: "Current account",
    kind: "cash",
    workingBalance: pence(100),
    archived: false,
    version: 1,
    automation: { provider: "monzo", connectionId: "monzo", externalId: "current" },
  };
  expect(bankRows([bank], [account])).toMatchObject([{ id: "account", total: 100 }]);
  expect(bankRows([bank], [{ ...account, archived: true }])).toMatchObject([
    { id: "monzo:monzo", total: null },
  ]);
});

it("labels Endute rows and uses each account's cached balance timestamp", () => {
  const bank: PublicBankConnection = {
    id: "endute",
    provider: "endute",
    version: 1,
    status: "ready",
    error: "Renew bank consent",
    valuation: {
      fetchedAt: "2026-09-27T12:00:00Z",
      balances: [
        {
          id: "card",
          parentAccountId: "card",
          name: "Card",
          type: "account",
          balance: pence(-100),
          fetchedAt: "2026-09-28T12:00:00Z",
        },
      ],
    },
  };
  expect(bankRows([bank], [])).toMatchObject([
    { name: "Endute Connect", provider: "Endute Connect", total: null },
  ]);
  expect(
    bankRows(
      [bank],
      [
        {
          id: "local",
          name: "Card",
          kind: "debt",
          version: 1,
          archived: false,
          workingBalance: pence(-100),
          automation: { provider: "endute", connectionId: "endute", externalId: "card" },
        },
      ],
    ),
  ).toMatchObject([
    {
      provider: "Endute Connect",
      type: "Debt",
      total: -100,
      fetchedAt: "2026-09-28T12:00:00Z",
      detail: "Renew bank consent",
    },
  ]);
});
