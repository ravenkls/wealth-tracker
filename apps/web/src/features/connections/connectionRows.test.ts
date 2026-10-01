import { expect, it } from "vitest";
import {
  pence,
  month,
  type PublicConnection,
  type PublicBankConnection,
  type ManualAccount,
} from "@wealth/domain";
import { bankRows, tradingRows, manualRows } from "./connectionRows";

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

it("combines manual account types without duplicating automated accounts and hides archived accounts", () => {
  const accounts: ManualAccount[] = [
    {
      id: "cash",
      name: "Cash",
      kind: "cash",
      archived: false,
      version: 1,
      workingBalance: pence(0),
    },
    {
      id: "debt",
      name: "Card",
      kind: "debt",
      archived: false,
      version: 1,
      workingBalance: pence(-500),
    },
    { id: "pension", name: "Pension", kind: "pension", archived: true, version: 1 },
    {
      id: "bank",
      name: "Bank",
      kind: "cash",
      archived: false,
      version: 1,
      automation: { provider: "endute", connectionId: "endute", externalId: "bank" },
    },
  ];
  expect(
    manualRows(accounts, []).map((row) => [row.id, row.provider, row.type, row.total]),
  ).toEqual([
    ["cash", "Manual", "Cash", 0],
    ["debt", "Manual", "Debt", -500],
  ]);
  expect(manualRows(accounts, [], true).map((row) => row.id)).toEqual(["cash", "debt", "pension"]);
});
it("uses the latest applicable snapshot regardless of ordering and prioritises a saved working balance", () => {
  const account = {
    id: "manual",
    name: "Savings",
    kind: "cash" as const,
    archived: false,
    version: 1,
    updatedAt: "2026-10-01T12:00:00Z",
  };
  const snapshots = [
    {
      month: month("2026-09"),
      updatedAt: "2026-09-30T12:00:00Z",
      balances: [
        { accountId: "manual", name: "Savings", kind: "cash" as const, balance: pence(200) },
      ],
    },
    { month: month("2026-10"), updatedAt: "2026-10-01T13:00:00Z", balances: [] },
    {
      month: month("2026-08"),
      updatedAt: "2026-08-31T12:00:00Z",
      balances: [
        { accountId: "manual", name: "Savings", kind: "cash" as const, balance: pence(100) },
      ],
    },
  ];
  expect(manualRows([account], snapshots)[0]).toMatchObject({
    total: 200,
    fetchedAt: snapshots[0]!.updatedAt,
  });
  expect(manualRows([{ ...account, workingBalance: pence(0) }], snapshots)[0]).toMatchObject({
    total: 0,
    fetchedAt: account.updatedAt,
  });
  expect(manualRows([account], [])[0]).toMatchObject({ total: null, fetchedAt: account.updatedAt });
});
