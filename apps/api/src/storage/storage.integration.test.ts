import { randomUUID } from "node:crypto";
import { CreateTableCommand, DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createLocalDatabase } from "../local/database";
import { DynamoAuthStore } from "../auth/store";
import { WealthStore } from "./records";
import { hasErrorName } from "./errors";
import { month, pence } from "@wealth/domain";
import type { Snapshot } from "@wealth/domain";
const database = createLocalDatabase(`http://127.0.0.1:${process.env.DYNAMODB_PORT ?? 8000}`);
const client = DynamoDBDocumentClient.from(database, {
  marshallOptions: { removeUndefinedValues: true },
});
const table = `wealth-test-${randomUUID()}`;
const auth = new DynamoAuthStore(client, table);
const store = new WealthStore(client, table);
beforeAll(async () => {
  await database.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
    }),
  );
});
afterAll(async () => {
  await database.send(new DeleteTableCommand({ TableName: table }));
  database.destroy();
});
it("expires sessions on read, slides valid sessions and never revives logout", async () => {
  await auth.saveSession({ tokenHash: "token", userId: "user", expiresAt: 200, createdAt: "now" });
  expect(await auth.validateSession("token", 201, true)).toBeNull();
  await auth.saveSession({ tokenHash: "valid", userId: "user", expiresAt: 200, createdAt: "now" });
  const session = await auth.validateSession("valid", 100, true);
  expect(session?.expiresAt).toBe(100 + 45 * 86400);
  await auth.deleteSession("valid");
  expect(await auth.validateSession("valid", 101, true)).toBeNull();
});
it("consumes a bound OAuth attempt only once", async () => {
  await auth.saveAttempt({
    stateHash: "oauth",
    bindingHash: "browser",
    nonce: "nonce",
    verifier: "secret",
    expiresAt: 200,
  });
  expect(await auth.consumeAttempt("oauth", "wrong-browser", 100)).toBeNull();
  expect((await auth.consumeAttempt("oauth", "browser", 100))?.verifier).toBe("secret");
  expect(await auth.consumeAttempt("oauth", "browser", 100)).toBeNull();
});
it("enforces user isolation, atomic monthly revisions and retry identity", async () => {
  const first: Snapshot = {
    month: month("2026-08"),
    version: 1,
    source: "historical",
    capturedAt: null,
    createdAt: "2026-09-28T12:00:00Z",
    updatedAt: "2026-09-28T12:00:00Z",
    balances: [],
    investments: [],
    cash: pence(10000),
    investmentTotal: pence(0),
    pensions: pence(0),
    total: pence(10000),
    notes: "",
    periodIncome: null,
    cashPensionContributions: null,
  };
  await store.saveSnapshot("user", first, 0, "op1", "digest1");
  expect(await store.snapshots.get("other", "2026-08")).toBeNull();
  const second = { ...first, version: 2, cash: pence(20000), total: pence(20000) };
  const outcomes = await Promise.allSettled([
    store.saveSnapshot("user", second, 1, "op2", "digest2"),
    store.saveSnapshot("user", second, 1, "op3", "digest3"),
  ]);
  expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await store.snapshots.list("user")).toHaveLength(1);
  expect(await store.revisions.list("user/2026-08")).toHaveLength(2);
  expect((await store.saveSnapshot("user", first, 0, "op1", "digest1")).version).toBe(1);
  expect((await store.snapshots.get("user", "2026-08"))?.version).toBe(2);
  await expect(store.receipt("user", "op1", "different")).rejects.toThrow("different inputs");
});

it("blocks valuation failures, replays committed saves and keeps provider values frozen in corrections", async () => {
  const { SnapshotService } = await import("../application/snapshot-service");
  const { LocalCredentialCipher } = await import("../auth/encryption");
  const owner = "snapshot-service-test",
    accountId = randomUUID();
  const cipher = new LocalCredentialCipher(Buffer.alloc(32, 2).toString("base64"));
  const provider: import("../integrations/trading212").InvestmentProvider = {
    value: async () => ({
      providerId: "212",
      total: pence(50000),
      cash: pence(10000),
      positions: [],
      fetchedAt: "2026-09-28T12:00:00Z",
    }),
    transactions: async () => ({ events: [], nextPage: null }),
    dividends: async () => ({ events: [], nextPage: null }),
  };
  const service = new SnapshotService(
    store,
    provider,
    cipher,
    () => new Date("2026-09-28T12:00:00Z"),
  );
  await store.accounts.save(
    owner,
    accountId,
    { id: accountId, name: "Cash", kind: "cash", archived: false, version: 1 },
    0,
  );
  const { ConnectionService } = await import("../application/connection-service");
  await new ConnectionService(store, provider, cipher).connect(owner, {
    name: "Invest",
    accountType: "invest",
    apiKey: "test",
    apiSecret: "test",
  });
  const input = {
    month: month("2026-09"),
    expectedVersion: 0,
    operationId: randomUUID(),
    replaceConfirmed: false,
    notes: "",
    balances: [{ accountId, balance: pence(-10000) }],
    periodIncome: pence(300000),
    cashPensionContributions: pence(0),
  };
  const value = provider.value;
  provider.value = async () => {
    throw new Error("Provider unavailable");
  };
  await expect(service.record(owner, input)).rejects.toThrow("Provider unavailable");
  expect(await store.snapshots.list(owner)).toHaveLength(0);
  provider.value = value;
  const saved = await service.record(owner, input);
  expect(saved.total).toBe(40000);
  provider.value = async () => {
    throw new Error("Never fetch on replay or correction");
  };
  expect(await service.record(owner, input)).toEqual(saved);
  await expect(
    service.correct(owner, { ...input, expectedVersion: 1, operationId: randomUUID() }),
  ).rejects.toThrow("Confirm replacing");
  const corrected = await service.correct(owner, {
    ...input,
    operationId: randomUUID(),
    expectedVersion: 1,
    replaceConfirmed: true,
    balances: [{ accountId, balance: pence(20000) }],
  });
  expect(corrected.total).toBe(70000);
  expect(corrected.investments).toEqual(saved.investments);
  expect(corrected.capturedAt).toBe(saved.capturedAt);
  expect(await store.revisions.list(`${owner}/2026-09`)).toHaveLength(2);
});

it("resumes provider history after rate limiting without losing its completed pages", async () => {
  const { ConnectionService } = await import("../application/connection-service");
  const { LocalCredentialCipher } = await import("../auth/encryption");
  const { Trading212Error } = await import("../integrations/trading212");
  let now = new Date("2026-09-28T12:00:00Z");
  let attempts = 0;
  const paths: (string | undefined)[] = [];
  const provider: import("../integrations/trading212").InvestmentProvider = {
    value: async () => ({
      providerId: "history",
      total: pence(100),
      cash: pence(100),
      positions: [],
      fetchedAt: now.toISOString(),
    }),
    transactions: async (_credentials, path) => {
      paths.push(path);
      if (++attempts === 2) throw new Trading212Error("Rate limited", 60);
      return {
        events: [
          {
            reference: attempts === 1 ? "a" : "b",
            source: "transaction",
            type: "DEPOSIT",
            amount: pence(100),
            occurredAt: now.toISOString(),
          },
        ],
        nextPage: attempts === 1 ? "/api/v0/equity/history/transactions?cursor=next" : null,
      };
    },
    dividends: async () => ({ events: [], nextPage: null }),
  };
  const service = new ConnectionService(
    store,
    provider,
    new LocalCredentialCipher(Buffer.alloc(32, 3).toString("base64")),
    () => now,
  );
  await service.connect("history-user", {
    name: "History",
    accountType: "invest",
    apiKey: "test",
    apiSecret: "test",
  });
  expect((await service.advanceHistory("history-user", "history")).history.transactionsDone).toBe(
    false,
  );
  await service.advanceHistory("history-user", "history");
  expect(paths).toHaveLength(1);
  now = new Date(now.getTime() + 11000);
  const limited = await service.advanceHistory("history-user", "history");
  expect(limited.history.error).toBe("Rate limited");
  now = new Date(now.getTime() + 61000);
  const finished = await service.advanceHistory("history-user", "history");
  expect(finished.history.completedAt).not.toBeNull();
  expect(paths).toEqual([
    undefined,
    "/api/v0/equity/history/transactions?cursor=next",
    "/api/v0/equity/history/transactions?cursor=next",
  ]);
  expect(await store.events.list("history-user/history")).toHaveLength(2);
});

it("autosaves user-scoped working balances and preferences without creating snapshots, rejecting stale edits", async () => {
  const { WealthService } = await import("../application/wealth-service");
  const service = new WealthService(store);
  const input = {
    id: randomUUID(),
    name: "Debt",
    kind: "cash" as const,
    archived: false,
    workingBalance: pence(-12345),
    expectedVersion: 0,
  };
  const first = await service.saveAccount("tables-user", input);
  expect(first.workingBalance).toBe(-12345);
  const edited = await service.saveAccount("tables-user", {
    ...input,
    name: "Renamed",
    workingBalance: undefined,
    expectedVersion: 1,
  });
  expect(edited.workingBalance).toBe(-12345);
  await expect(
    service.saveAccount("tables-user", { ...input, expectedVersion: 1 }),
  ).rejects.toThrow("changed");
  const prefs = {
    columnOrder: ["balance", "name"],
    rowOrder: [input.id],
    grouping: ["kind"],
    sorting: [],
  };
  await service.savePreferences("tables-user", "accounts", prefs, 0);
  expect((await service.bootstrap("tables-user")).preferences[0]?.preferences).toEqual(prefs);
  expect((await service.bootstrap("other-tables-user")).preferences).toEqual([]);
  expect(await store.snapshots.list("tables-user")).toEqual([]);
  await expect(service.savePreferences("tables-user", "accounts", prefs, 0)).rejects.toThrow(
    "changed",
  );
});

it("autosaves historical and individual balance corrections atomically while freezing provider valuations", async () => {
  const { SnapshotService } = await import("../application/snapshot-service");
  const { LocalCredentialCipher } = await import("../auth/encryption");
  const provider: import("../integrations/trading212").InvestmentProvider = {
    value: async () => {
      throw new Error("Corrections must not fetch");
    },
    transactions: async () => ({ events: [], nextPage: null }),
    dividends: async () => ({ events: [], nextPage: null }),
  };
  const service = new SnapshotService(
    store,
    provider,
    new LocalCredentialCipher(Buffer.alloc(32, 4).toString("base64")),
  );
  const original = (await store.snapshots.get("user", "2026-08"))!.data;
  const imported = { ...original, month: month("2026-09"), version: 1 };
  await store.saveSnapshot("inline", imported, 0, randomUUID(), "import");
  const input = {
    month: imported.month,
    expectedVersion: 1,
    operationId: randomUUID(),
    change: { field: "cash" as const, value: pence(-3000) },
  };
  const updated = await service.inlineCorrect("inline", input);
  expect(updated.total).toBe(-3000);
  expect(await service.inlineCorrect("inline", input)).toEqual(updated);
  expect(await store.revisions.list("inline/2026-09")).toHaveLength(2);
  await expect(
    service.inlineCorrect("inline", { ...input, operationId: randomUUID() }),
  ).rejects.toThrow("changed");
  await expect(service.inlineCorrect("another-user", input)).rejects.toThrow("changed");
  const recorded = (await store.snapshots.get("snapshot-service-test", "2026-09"))!.data;
  const base = {
    month: recorded.month,
    expectedVersion: recorded.version,
    operationId: randomUUID(),
  };
  await expect(
    service.inlineCorrect("snapshot-service-test", {
      ...base,
      change: { field: "investmentTotal", value: pence(1) },
    }),
  ).rejects.toThrow("read-only");
  const corrected = await service.inlineCorrect("snapshot-service-test", {
    ...base,
    change: { field: "balance", accountId: recorded.balances[0]!.accountId, value: pence(700) },
  });
  expect(corrected.investments).toEqual(recorded.investments);
  expect(corrected.capturedAt).toBe(recorded.capturedAt);
  expect(corrected.total).toBe(50700);
});

it("persists optional canonical budget categories through versioned saves", async () => {
  const { WealthService } = await import("../application/wealth-service");
  const { budgetInput } = await import("../application/schemas");
  const service = new WealthService(store);
  const base = {
    id: randomUUID(),
    name: "Food",
    amount: 10000,
    frequency: "monthly",
    destinationId: null,
  };
  const input = budgetInput.parse({
    expectedVersion: 0,
    plan: {
      salary: 300000,
      payFrequency: "monthly",
      sideIncome: 0,
      expenses: [
        { ...base, category: " Living " },
        { ...base, id: randomUUID() },
      ],
      savingsAllocations: [{ ...base, id: randomUUID(), category: "living" }],
      emergencyMonths: null,
      targetCashShare: null,
      aggressiveness: 1,
      cashDestinationId: null,
      investmentDestinationId: null,
      cashGoal: null,
      endOfYearGoal: null,
      depositGoal: null,
      depositInvestmentFraction: null,
      depositSavingsFraction: null,
      jobStartMonth: null,
    },
  });
  await service.saveBudget("categories-user", input.plan, 0);
  const saved = (await service.bootstrap("categories-user")).budget!;
  expect(saved.plan.expenses[0]?.category).toBe("Living");
  expect(saved.plan.expenses[1]?.category).toBeNull();
  expect(saved.plan.savingsAllocations[0]?.category).toBe("Living");
  expect((await service.bootstrap("other-categories-user")).budget).toBeNull();
  await expect(service.saveBudget("categories-user", input.plan, 0)).rejects.toThrow("changed");
});

it("persists theme per user and rejects stale preference writes", async () => {
  const { WealthService } = await import("../application/wealth-service");
  const service = new WealthService(store);
  expect(await service.appearance("theme-user")).toEqual({ mode: "dark", version: 0 });
  expect(await service.saveAppearance("theme-user", "light", 0)).toEqual({
    mode: "light",
    version: 1,
  });
  const reloaded = new WealthService(new WealthStore(client, table));
  expect(await reloaded.appearance("theme-user")).toEqual({ mode: "light", version: 1 });
  expect(await reloaded.appearance("other-theme-user")).toEqual({ mode: "dark", version: 0 });
  await expect(service.saveAppearance("theme-user", "dark", 0)).rejects.toThrow(
    "changed in another tab",
  );
  expect(await reloaded.appearance("theme-user")).toEqual({ mode: "light", version: 1 });
  expect(await service.saveAppearance("theme-user", "dark", 1)).toEqual({
    mode: "dark",
    version: 2,
  });
});

it("persists overview asset selection per user with the latest write winning", async () => {
  const { WealthService } = await import("../application/wealth-service");
  const service = new WealthService(store);
  expect((await service.bootstrap("overview-user")).overview).toBeNull();
  await service.saveOverview("overview-user", { netWorthAssets: ["cash"] });
  await service.saveOverview("overview-user", { netWorthAssets: ["cash", "pensions"] });
  const reloaded = new WealthService(new WealthStore(client, table));
  expect((await reloaded.bootstrap("overview-user")).overview).toEqual({
    netWorthAssets: ["cash", "pensions"],
  });
  expect((await reloaded.bootstrap("other-overview-user")).overview).toBeNull();
});

it("records all manual asset types, preserves old classifications and recomputes investment corrections", async () => {
  const { WealthService } = await import("../application/wealth-service");
  const { SnapshotService } = await import("../application/snapshot-service");
  const { ConnectionService } = await import("../application/connection-service");
  const { LocalCredentialCipher } = await import("../auth/encryption");
  const wealth = new WealthService(store);
  const owner = "manual-types";
  const cipher = new LocalCredentialCipher(Buffer.alloc(32, 4).toString("base64"));
  const provider: import("../integrations/trading212").InvestmentProvider = {
    value: async () => ({
      providerId: "auto",
      total: pence(50000),
      cash: pence(10000),
      positions: [],
      fetchedAt: "2026-09-28T12:00:00Z",
    }),
    transactions: async () => ({ events: [], nextPage: null }),
    dividends: async () => ({ events: [], nextPage: null }),
  };
  await new ConnectionService(store, provider, cipher).connect(owner, {
    name: "Automated",
    accountType: "invest",
    apiKey: "test",
    apiSecret: "test",
  });
  const definitions = [
    ["cash", 100000],
    ["debt", -20000],
    ["investment", 300000],
    ["pension", 400000],
  ] as const;
  const accounts = await Promise.all(
    definitions.map(([kind, value]) =>
      wealth.saveAccount(owner, {
        id: randomUUID(),
        name: kind,
        kind,
        archived: false,
        workingBalance: pence(value),
        expectedVersion: 0,
      }),
    ),
  );
  const snapshots = new SnapshotService(
    store,
    provider,
    cipher,
    () => new Date("2026-09-28T12:00:00Z"),
  );
  const input = {
    month: month("2026-09"),
    expectedVersion: 0,
    operationId: randomUUID(),
    replaceConfirmed: false,
    notes: "",
    periodIncome: pence(300000),
    cashPensionContributions: pence(0),
    balances: accounts.map((account) => ({
      accountId: account.id,
      balance: account.workingBalance!,
    })),
  };
  const recorded = await snapshots.record(owner, input);
  expect(recorded).toMatchObject({
    cash: 80000,
    investmentTotal: 350000,
    pensions: 400000,
    total: 830000,
  });
  const cash = accounts[0]!;
  const debt = await wealth.saveAccount(owner, { ...cash, kind: "debt", expectedVersion: 1 });
  expect(debt.workingBalance).toBe(100000);
  expect(
    (await store.snapshots.get(owner, input.month))?.data.balances.find(
      (row) => row.accountId === cash.id,
    )?.kind,
  ).toBe("cash");
  await expect(
    wealth.saveAccount(owner, { ...debt, kind: "investment", expectedVersion: 2 }),
  ).rejects.toThrow("Only Cash and Debt");
  expect(
    (await wealth.saveAccount(owner, { ...debt, kind: "cash", expectedVersion: 2 })).kind,
  ).toBe("cash");
  provider.value = async () => {
    throw new Error("Do not refetch during corrections");
  };
  const corrected = await snapshots.inlineCorrect(owner, {
    month: input.month,
    expectedVersion: 1,
    operationId: randomUUID(),
    change: { field: "balance", accountId: accounts[2]!.id, value: pence(350000) },
  });
  expect(corrected).toMatchObject({
    cash: 80000,
    investmentTotal: 400000,
    pensions: 400000,
    total: 880000,
  });
  expect(corrected.investments).toEqual(recorded.investments);
  const fullCorrection = await snapshots.correct(owner, {
    ...input,
    operationId: randomUUID(),
    expectedVersion: 2,
    replaceConfirmed: true,
  });
  expect(fullCorrection).toMatchObject({ investmentTotal: 350000, total: 830000 });
  expect(fullCorrection.investments).toEqual(recorded.investments);
  expect(await wealth.revisions(owner, input.month)).toHaveLength(3);
  const budget: import("@wealth/domain").BudgetPlan = {
    salary: pence(300000),
    payFrequency: "monthly",
    sideIncome: pence(0),
    expenses: [
      {
        id: randomUUID(),
        name: "Card repayment",
        amount: pence(10000),
        frequency: "monthly",
        destinationId: accounts[1]!.id,
      },
    ],
    savingsAllocations: [],
    emergencyMonths: null,
    targetCashShare: null,
    aggressiveness: 1,
    cashDestinationId: null,
    investmentDestinationId: accounts[2]!.id,
    cashGoal: null,
    endOfYearGoal: null,
    depositGoal: null,
    depositInvestmentFraction: null,
    depositSavingsFraction: null,
    jobStartMonth: null,
  };
  expect((await wealth.saveBudget(owner, budget, 0)).data.investmentDestinationId).toBe(
    accounts[2]!.id,
  );
});

it("reconciles enriched history through bootstrap and preserves revisions when assumed income is corrected", async () => {
  const { prepareHistoricalSavings } = await import("../application/historical-savings");
  const { WealthService } = await import("../application/wealth-service");
  const { SnapshotService } = await import("../application/snapshot-service");
  const { LocalCredentialCipher } = await import("../auth/encryption");
  const owner = "enriched-history-user";
  const now = new Date("2026-09-28T12:00:00Z");
  const originals: Snapshot[] = ["2026-07", "2026-09"].map((value, index) => ({
    month: month(value),
    version: 1,
    source: "historical",
    capturedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    balances: [],
    investments: [],
    cash: pence(100000 + index * 10000),
    investmentTotal: pence(100000),
    pensions: pence(200000),
    total: pence(400000 + index * 10000),
    notes: "Imported",
    periodIncome: null,
    cashPensionContributions: null,
  }));
  for (const snapshot of originals)
    await store.saveSnapshot(owner, snapshot, 0, randomUUID(), snapshot.month);
  const enhanced = prepareHistoricalSavings(
    originals,
    { connectionIds: ["broker"], cashCoverageId: "same-cash", monthlyIncome: pence(300000) },
    now,
  );
  for (const snapshot of enhanced)
    await store.saveSnapshot(owner, snapshot, 1, randomUUID(), snapshot.month);
  const connection: import("@wealth/domain").Connection = {
    id: "broker",
    name: "Broker",
    accountType: "isa",
    version: 1,
    encryptedCredentials: null,
    disconnected: false,
    valuation: {
      connectionId: "broker",
      name: "Broker",
      accountType: "isa",
      total: pence(100000),
      cash: pence(0),
      fetchedAt: now.toISOString(),
      positions: [],
    },
    history: {
      transactionsNext: null,
      dividendsNext: null,
      transactionsDone: true,
      dividendsDone: true,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      retryAt: null,
      error: null,
    },
  };
  await store.connections.save(owner, "broker", connection, 0);
  await store.events.save(
    `${owner}/broker`,
    "deposit",
    {
      reference: "deposit",
      source: "transaction",
      type: "DEPOSIT",
      amount: pence(20000),
      occurredAt: "2026-08-01T12:00:00Z",
    },
    0,
  );
  const wealth = new WealthService(store);
  const before = await wealth.bootstrap(owner);
  expect(before.metrics[1]?.result).toMatchObject({
    status: "complete",
    saved: 30000,
    income: 600000,
    spending: 570000,
  });
  expect(before.projections?.eligibleIntervals).toBe(1);
  const provider: import("../integrations/trading212").InvestmentProvider = {
    value: async () => {
      throw new Error("Do not fetch a historical valuation");
    },
    transactions: async () => ({ events: [], nextPage: null }),
    dividends: async () => ({ events: [], nextPage: null }),
  };
  const snapshots = new SnapshotService(
    store,
    provider,
    new LocalCredentialCipher(Buffer.alloc(32, 7).toString("base64")),
    () => now,
  );
  const input = {
    month: month("2026-09"),
    expectedVersion: 2,
    operationId: randomUUID(),
    change: { field: "periodIncome" as const, value: pence(610000) },
  };
  const saved = await snapshots.inlineCorrect(owner, input);
  expect(saved.historicalSavings?.assumedMonthlyIncome).toBeNull();
  expect(saved.total).toBe(410000);
  expect((await wealth.bootstrap(owner)).metrics[1]?.result).toMatchObject({
    status: "complete",
    income: 610000,
  });
  expect(await snapshots.inlineCorrect(owner, input)).toEqual(saved);
  expect(
    (await store.revisions.get(`${owner}/2026-09`, "0000000002"))?.data.historicalSavings
      ?.assumedMonthlyIncome,
  ).toBe(300000);
  await expect(
    snapshots.inlineCorrect(owner, { ...input, operationId: randomUUID() }),
  ).rejects.toThrow("changed");
  await store.connections.save(
    owner,
    "broker",
    { ...connection, version: 2, history: { ...connection.history, completedAt: null } },
    1,
  );
  expect((await wealth.bootstrap(owner)).metrics[1]?.result.status).toBe("unavailable");
});

async function monzoFixture(owner = randomUUID()) {
  const { MonzoService } = await import("../application/monzo-service");
  const { LocalCredentialCipher } = await import("../auth/encryption");
  const { vi } = await import("vitest");
  let time = new Date("2026-09-28T12:00:00Z");
  const cipher = new LocalCredentialCipher(Buffer.alloc(32, 3).toString("base64"));
  const provider = {
    authorizeUrl: (_client: string, _redirect: string, state: string) =>
      `https://auth.monzo.com/?state=${state}`,
    exchange: vi.fn(async () => ({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: "2026-09-28T18:00:00Z",
      userId: "monzo-user",
    })),
    refresh: vi.fn(async () => ({
      accessToken: "rotated-access",
      refreshToken: "rotated-refresh",
      expiresAt: "2026-09-29T00:00:00Z",
      userId: "monzo-user",
    })),
    value: vi.fn(async () => ({
      balances: [
        {
          id: "acc",
          parentAccountId: "acc",
          name: "Personal",
          type: "account" as const,
          balance: pence(69334),
        },
        {
          id: "pot",
          parentAccountId: "acc",
          name: "Savings",
          type: "pot" as const,
          balance: pence(20000),
        },
      ],
      fetchedAt: time.toISOString(),
    })),
    revoke: vi.fn(async () => {}),
  };
  const service = new MonzoService(store, provider, cipher, "https://wealth.example", () => time);
  const start = await service.start(owner, "session", {
    clientId: "client",
    clientSecret: "secret",
  });
  const state = new URL(start.url).searchParams.get("state")!;
  return {
    owner,
    cipher,
    provider,
    service,
    state,
    setTime: (value: string) => {
      time = new Date(value);
    },
  };
}
it("binds Monzo OAuth to user, session, expiry and one-use state; encrypts secrets", async () => {
  const f = await monzoFixture();
  await expect(f.service.complete("other-user", "session", f.state, "code")).rejects.toThrow(
    "expired",
  );
  await expect(f.service.complete(f.owner, "other-session", f.state, "code")).rejects.toThrow(
    "expired",
  );
  expect(f.provider.exchange).not.toHaveBeenCalled();
  const id = await f.service.complete(f.owner, "session", f.state, "code");
  await expect(f.service.complete(f.owner, "session", f.state, "code")).rejects.toThrow("expired");
  const record = await store.banks.get(f.owner, id);
  expect(record?.data.encryptedCredentials).not.toContain("secret");
  expect(await store.banks.get("other-user", id)).toBeNull();
  const expired = await monzoFixture();
  expired.setTime("2026-09-28T12:11:00Z");
  await expect(
    expired.service.complete(expired.owner, "session", expired.state, "code"),
  ).rejects.toThrow("expired");
});
it("selects individual Monzo balances as new accounts without exposing secrets, then converts on disconnect", async () => {
  const f = await monzoFixture();
  const id = await f.service.complete(f.owner, "session", f.state, "code");
  const bank = await f.service.refresh(f.owner, id);
  expect(JSON.stringify(bank)).not.toMatch(
    /encryptedCredentials|accessToken|refreshToken|clientSecret/,
  );
  await f.service.select(f.owner, id, ["pot"], bank.version);
  let accounts = await store.accounts.list(f.owner);
  expect(accounts).toHaveLength(1);
  expect(accounts[0]?.data).toMatchObject({
    kind: "cash",
    workingBalance: 20000,
    automation: { provider: "monzo", externalId: "pot" },
  });
  const selected = (await store.banks.get(f.owner, id))!;
  await expect(f.service.select(f.owner, id, ["acc"], bank.version)).rejects.toThrow(
    "changed in another tab",
  );
  expect(await store.accounts.list(f.owner)).toHaveLength(1);
  await f.service.disconnect(f.owner, id, selected.version);
  accounts = await store.accounts.list(f.owner);
  expect(accounts[0]?.id).toBe(accounts[0]?.data.id);
  expect(accounts[0]?.data.automation).toBeUndefined();
  expect(accounts[0]?.data.workingBalance).toBe(20000);
  expect((await store.banks.get(f.owner, id))?.data.encryptedCredentials).toBeNull();
  expect(f.provider.revoke).toHaveBeenCalledWith("access");
});
it("serializes Monzo refreshes across requests and persists rotated tokens", async () => {
  const f = await monzoFixture();
  const id = await f.service.complete(f.owner, "session", f.state, "code");
  f.setTime("2026-09-28T18:00:00Z");
  const results = await Promise.allSettled([
    f.service.refresh(f.owner, id),
    f.service.refresh(f.owner, id),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(f.provider.refresh).toHaveBeenCalledTimes(1);
  expect(f.provider.value).toHaveBeenCalledWith("rotated-access");
  await f.service.refresh(f.owner, id);
  expect(f.provider.refresh).toHaveBeenCalledTimes(1);
});
it("requires reconnection after an ambiguous one-use refresh failure instead of replaying it", async () => {
  const f = await monzoFixture();
  const id = await f.service.complete(f.owner, "session", f.state, "code");
  f.setTime("2026-09-28T18:00:00Z");
  f.provider.refresh.mockRejectedValue(new Error("network interrupted"));
  await expect(f.service.refresh(f.owner, id)).rejects.toThrow("network interrupted");
  expect((await store.banks.get(f.owner, id))?.data.status).toBe("reconnect");
  await expect(f.service.refresh(f.owner, id)).rejects.toThrow("Reconnect");
  expect(f.provider.refresh).toHaveBeenCalledTimes(1);
});
it("archives missing pots only after a successful complete refresh", async () => {
  const f = await monzoFixture();
  const id = await f.service.complete(f.owner, "session", f.state, "code");
  const bank = await f.service.refresh(f.owner, id);
  await f.service.select(f.owner, id, ["pot"], bank.version);
  f.provider.value.mockRejectedValueOnce(new Error("API unavailable"));
  await expect(f.service.refresh(f.owner, id)).rejects.toThrow("API unavailable");
  expect((await store.accounts.list(f.owner))[0]?.data.archived).toBe(false);
  f.provider.value.mockResolvedValue({ balances: [], fetchedAt: "2026-09-28T12:00:00Z" });
  await f.service.refresh(f.owner, id);
  expect((await store.accounts.list(f.owner))[0]?.data).toMatchObject({
    archived: true,
    workingBalance: 20000,
  });
});
it("records live Monzo cash, blocks failures, and prevents edits to recorded automated balances", async () => {
  const f = await monzoFixture();
  const id = await f.service.complete(f.owner, "session", f.state, "code");
  const bank = await f.service.refresh(f.owner, id);
  await f.service.select(f.owner, id, ["acc", "pot"], bank.version);
  const { SnapshotService } = await import("../application/snapshot-service");
  const provider: import("../integrations/trading212").InvestmentProvider = {
    value: async () => {
      throw new Error("Unused");
    },
    transactions: async () => ({ events: [], nextPage: null }),
    dividends: async () => ({ events: [], nextPage: null }),
  };
  const snapshots = new SnapshotService(
    store,
    provider,
    f.cipher,
    () => new Date("2026-09-28T12:00:00Z"),
    f.service,
  );
  const input = {
    month: month("2026-09"),
    expectedVersion: 0,
    operationId: randomUUID(),
    replaceConfirmed: false,
    notes: "",
    balances: [],
    periodIncome: pence(100000),
    cashPensionContributions: pence(0),
  };
  f.provider.value.mockRejectedValueOnce(new Error("Unavailable"));
  await expect(snapshots.record(f.owner, input)).rejects.toThrow("Unavailable");
  expect(await store.snapshots.list(f.owner)).toHaveLength(0);
  const saved = await snapshots.record(f.owner, input);
  expect(saved.cash).toBe(89334);
  expect(saved.total).toBe(89334);
  expect(saved.investmentTotal).toBe(0);
  expect(saved.balances.every((balance) => balance.automation?.provider === "monzo")).toBe(true);
  await expect(
    snapshots.inlineCorrect(f.owner, {
      month: input.month,
      expectedVersion: 1,
      operationId: randomUUID(),
      change: { field: "balance", accountId: saved.balances[0]!.accountId, value: pence(0) },
    }),
  ).rejects.toThrow("manual account");
  const corrected = await snapshots.correct(f.owner, {
    ...input,
    expectedVersion: 1,
    operationId: randomUUID(),
    replaceConfirmed: true,
    notes: "Correction",
  });
  expect(corrected.balances).toEqual(saved.balances);
  expect(corrected.total).toBe(saved.total);
});

it("preserves automated Flex as signed debt through selection, snapshots and disconnect", async () => {
  const f = await monzoFixture();
  const id = await f.service.complete(f.owner, "session", f.state, "code");
  const flex = {
    id: "flex",
    parentAccountId: "flex",
    name: "Monzo Flex",
    type: "account" as const,
    kind: "debt" as const,
    balance: pence(-12000),
  };
  f.provider.value.mockResolvedValue({ balances: [flex], fetchedAt: "2026-09-28T12:00:00Z" });
  const bank = await f.service.refresh(f.owner, id);
  await f.service.select(f.owner, id, ["flex"], bank.version);
  const accounts = (await store.accounts.list(f.owner)).map((record) => record.data);
  expect(accounts[0]).toMatchObject({ kind: "debt", workingBalance: -12000 });
  expect(await f.service.snapshotBalances(f.owner, accounts)).toEqual([
    expect.objectContaining({ kind: "debt", balance: -12000 }),
  ]);
  const current = (await store.banks.get(f.owner, id))!;
  await f.service.disconnect(f.owner, id, current.version);
  expect((await store.accounts.list(f.owner))[0]?.data).toMatchObject({
    kind: "debt",
    workingBalance: -12000,
  });
});

it("persists Trading 212 display choices without changing valuations and rejects stale or cross-user changes", async () => {
  const { ConnectionService } = await import("../application/connection-service");
  const { LocalCredentialCipher } = await import("../auth/encryption");
  const provider: import("../integrations/trading212").InvestmentProvider = {
    value: async () => ({
      providerId: "display",
      total: pence(12500),
      cash: pence(2500),
      positions: [{ ticker: "ABC", name: "Example", quantity: 2, value: pence(10000) }],
      fetchedAt: "2026-09-28T12:00:00Z",
    }),
    transactions: async () => ({ events: [], nextPage: null }),
    dividends: async () => ({ events: [], nextPage: null }),
  };
  const service = new ConnectionService(
    store,
    provider,
    new LocalCredentialCipher(Buffer.alloc(32, 9).toString("base64")),
  );
  const connected = await service.connect("display-user", {
    name: "Stocks ISA",
    accountType: "isa",
    apiKey: "test",
    apiSecret: "test",
    displayMode: "holdings",
  });
  expect(connected.displayMode).toBe("holdings");
  const updated = await service.setDisplayMode(
    "display-user",
    "display",
    "account",
    connected.version,
  );
  expect((await store.connections.get("display-user", "display"))?.data.displayMode).toBe(
    "account",
  );
  expect(updated.valuation).toEqual(connected.valuation);
  expect(updated.history).toEqual(connected.history);
  expect(updated).not.toHaveProperty("encryptedCredentials");
  await expect(
    service.setDisplayMode("display-user", "display", "holdings", connected.version),
  ).rejects.toThrow("changed in another tab");
  await expect(
    service.setDisplayMode("other-display-user", "display", "holdings", updated.version),
  ).rejects.toThrow("Connection not found");
  expect((await service.refreshValue("display-user", "display")).displayMode).toBe("account");
  expect(await store.snapshots.list("display-user")).toEqual([]);
  expect(await store.accounts.list("display-user")).toEqual([]);
  const latest = (await store.connections.get("display-user", "display"))!;
  await service.disconnect("display-user", "display", latest.version);
  await expect(
    service.setDisplayMode("display-user", "display", "holdings", latest.version + 1),
  ).rejects.toThrow("Connection not found");
});

it("persists reserve settings and essential expenses without changing allocation rules, validating account ownership and kinds", async () => {
  const { WealthService } = await import("../application/wealth-service");
  const service = new WealthService(store);
  const { budgetInput } = await import("../application/schemas");
  const reserveId = randomUUID();
  await service.saveAccount("reserve-user", {
    id: reserveId,
    name: "Reserve",
    kind: "cash",
    archived: false,
    workingBalance: pence(123400),
    expectedVersion: 0,
  });
  const input = budgetInput.parse({
    expectedVersion: 0,
    plan: {
      forecastAssumptions: {
        spendingLow: -10000,
        spendingUsual: 20000,
        spendingHigh: 50000,
        annualGrowth: 0.05,
        annualVolatility: 0.18,
      },
      emergencyAccountIds: [reserveId],
      salary: 300000,
      payFrequency: "monthly",
      sideIncome: 0,
      expenses: [
        {
          id: randomUUID(),
          name: "Rent",
          amount: 100000,
          frequency: "monthly",
          destinationId: null,
          essential: true,
        },
      ],
      savingsAllocations: [],
      emergencyMonths: 3,
      targetCashShare: 0.2,
      aggressiveness: 1,
      cashDestinationId: null,
      investmentDestinationId: null,
      cashGoal: null,
      endOfYearGoal: null,
      depositGoal: null,
      depositInvestmentFraction: null,
      depositSavingsFraction: null,
      jobStartMonth: null,
    },
  });
  await service.saveBudget("reserve-user", input.plan, 0);
  const saved = (await service.bootstrap("reserve-user")).budget!;
  expect(saved.plan.emergencyAccountIds).toEqual([reserveId]);
  expect(saved.plan.forecastAssumptions).toEqual(input.plan.forecastAssumptions);
  expect(
    budgetInput.safeParse({
      ...input,
      plan: {
        ...input.plan,
        forecastAssumptions: { ...input.plan.forecastAssumptions, spendingLow: 60000 },
      },
    }).success,
  ).toBe(false);
  expect(
    budgetInput.safeParse({
      ...input,
      plan: {
        ...input.plan,
        forecastAssumptions: { ...input.plan.forecastAssumptions, annualGrowth: -1 },
      },
    }).success,
  ).toBe(false);
  expect(saved.plan.expenses[0]?.essential).toBe(true);
  await expect(service.saveBudget("other-reserve-user", input.plan, 0)).rejects.toThrow(
    "active cash accounts",
  );
  await expect(service.saveBudget("reserve-user", input.plan, 0)).rejects.toThrow(
    "changed in another tab",
  );
  await service.saveAccount("reserve-user", {
    id: reserveId,
    name: "Reserve",
    kind: "debt",
    archived: false,
    expectedVersion: 1,
  });
  await expect(service.saveBudget("reserve-user", input.plan, 1)).rejects.toThrow(
    "active cash accounts",
  );
  await service.saveBudget("reserve-user", { ...input.plan, emergencyAccountIds: [] }, 1);
  expect((await service.bootstrap("reserve-user")).budget?.plan.emergencyAccountIds).toEqual([]);
});

it("replaces archived budget destinations with automated Monzo accounts one at a time", async () => {
  const { WealthService } = await import("../application/wealth-service");
  const { budgetInput } = await import("../application/schemas");
  const service = new WealthService(store);
  const owner = "budget-destination-repair";
  const [oldCash, oldBills, monzoCash, monzoDebt] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ] as const;
  for (const id of [oldCash, oldBills])
    await service.saveAccount(owner, {
      id,
      name: "Manual account",
      kind: "cash",
      archived: false,
      expectedVersion: 0,
    });
  for (const [id, kind] of [
    [monzoCash, "cash"],
    [monzoDebt, "debt"],
  ] as const)
    await store.accounts.save(
      owner,
      id,
      {
        id,
        name: `Monzo ${kind}`,
        kind,
        archived: false,
        version: 1,
        automation: { provider: "monzo", connectionId: "monzo-bank", externalId: id },
      },
      0,
    );
  const initial = budgetInput.parse({
    expectedVersion: 0,
    plan: {
      salary: 300000,
      payFrequency: "monthly",
      sideIncome: 0,
      expenses: [
        {
          id: randomUUID(),
          name: "Groceries",
          amount: 20000,
          frequency: "monthly",
          destinationId: oldCash,
        },
        {
          id: randomUUID(),
          name: "Rent",
          amount: 100000,
          frequency: "monthly",
          destinationId: oldBills,
        },
      ],
      savingsAllocations: [
        {
          id: randomUUID(),
          name: "Holiday",
          amount: 20000,
          frequency: "monthly",
          destinationId: oldBills,
        },
      ],
      emergencyMonths: 3,
      targetCashShare: 0.2,
      aggressiveness: 1,
      cashDestinationId: oldCash,
      investmentDestinationId: oldBills,
      cashGoal: null,
      endOfYearGoal: null,
      depositGoal: null,
      depositInvestmentFraction: null,
      depositSavingsFraction: null,
      jobStartMonth: null,
    },
  }).plan;
  await service.saveBudget(owner, initial, 0);
  for (const id of [oldCash, oldBills])
    await service.saveAccount(owner, {
      id,
      name: "Manual account",
      kind: "cash",
      archived: true,
      expectedVersion: 1,
    });
  const first = {
    ...initial,
    expenses: initial.expenses.map((line, index) =>
      index === 0 ? { ...line, destinationId: monzoCash } : line,
    ),
  };
  await service.saveBudget(owner, first, 1);
  const second = {
    ...first,
    expenses: first.expenses.map((line) => ({ ...line, essential: true })),
  };
  await service.saveBudget(owner, second, 2);
  expect((await service.bootstrap(owner)).budget?.plan.expenses).toMatchObject([
    { destinationId: monzoCash, essential: true },
    { destinationId: oldBills, essential: true },
  ]);
  const repaired = {
    ...second,
    cashDestinationId: monzoCash,
    investmentDestinationId: monzoCash,
    expenses: second.expenses.map((line) => ({ ...line, destinationId: monzoDebt })),
    savingsAllocations: second.savingsAllocations.map((line) => ({
      ...line,
      destinationId: monzoCash,
    })),
  };
  await service.saveBudget(owner, repaired, 3);
  expect((await service.bootstrap(owner)).budget?.plan.cashDestinationId).toBe(monzoCash);
  await expect(service.saveBudget(owner, repaired, 3)).rejects.toThrow("changed in another tab");
  await expect(
    service.saveBudget(
      owner,
      { ...repaired, expenses: [{ ...repaired.expenses[0]!, destinationId: oldCash }] },
      4,
    ),
  ).rejects.toThrow("Groceries: choose an active");
  await expect(
    service.saveBudget(
      owner,
      {
        ...repaired,
        expenses: [{ ...repaired.expenses[0]!, id: randomUUID(), destinationId: oldBills }],
      },
      4,
    ),
  ).rejects.toThrow("active cash or debt");
  await expect(
    service.saveBudget(
      owner,
      { ...repaired, expenses: [{ ...repaired.expenses[0]!, destinationId: randomUUID() }] },
      4,
    ),
  ).rejects.toThrow("active cash or debt");
  await expect(service.saveBudget("other-budget-owner", repaired, 0)).rejects.toThrow(
    "active cash or debt",
  );
});

it("allows investment and pension savings targets while protecting expense kinds, ownership and archived destinations", async () => {
  const { WealthService } = await import("../application/wealth-service");
  const { budgetInput } = await import("../application/schemas");
  const service = new WealthService(store);
  const owner = "planned-saving-targets";
  const investment = randomUUID(),
    pension = randomUUID(),
    broker = randomUUID();
  for (const [id, kind] of [
    [investment, "investment"],
    [pension, "pension"],
  ] as const)
    await service.saveAccount(owner, { id, name: kind, kind, archived: false, expectedVersion: 0 });
  const now = "2026-09-01T00:00:00Z";
  const connection: import("@wealth/domain").Connection = {
    id: broker,
    name: "ISA",
    accountType: "isa",
    version: 1,
    encryptedCredentials: null,
    disconnected: false,
    valuation: {
      connectionId: broker,
      name: "ISA",
      accountType: "isa",
      total: pence(0),
      cash: pence(0),
      fetchedAt: now,
      positions: [],
    },
    history: {
      transactionsNext: null,
      dividendsNext: null,
      transactionsDone: true,
      dividendsDone: true,
      startedAt: now,
      completedAt: now,
      retryAt: null,
      error: null,
    },
  };
  await store.connections.save(owner, broker, connection, 0);
  const plan = budgetInput.parse({
    expectedVersion: 0,
    plan: {
      salary: 300000,
      payFrequency: "monthly",
      sideIncome: 0,
      expenses: [],
      savingsAllocations: [investment, pension, broker].map((id) => ({
        id: randomUUID(),
        name: "Savings",
        amount: 10000,
        frequency: "monthly",
        destinationId: id,
      })),
      emergencyMonths: 3,
      targetCashShare: 0.2,
      aggressiveness: 1,
      cashDestinationId: null,
      investmentDestinationId: null,
      cashGoal: null,
      endOfYearGoal: null,
      depositGoal: null,
      depositInvestmentFraction: null,
      depositSavingsFraction: null,
      jobStartMonth: null,
    },
  }).plan;
  await service.saveBudget(owner, plan, 0);
  const saved = await service.bootstrap(owner);
  expect(saved.budget?.plan.savingsAllocations.map((line) => line.destinationId)).toEqual([
    investment,
    pension,
    broker,
  ]);
  expect(saved.budgetSummary).toMatchObject({ investmentSavings: 20000, pensionSavings: 10000 });
  expect(saved.budgetSummary?.plannedSavingsRate).toBeCloseTo(290000 / 300000);
  for (const id of [investment, pension, broker]) {
    await expect(
      service.saveBudget(
        owner,
        {
          ...plan,
          expenses: [{ ...plan.savingsAllocations[0]!, id: randomUUID(), destinationId: id }],
        },
        1,
      ),
    ).rejects.toThrow("active cash or debt");
    await expect(
      service.saveBudget(
        "other-saving-user",
        { ...plan, savingsAllocations: [{ ...plan.savingsAllocations[0]!, destinationId: id }] },
        0,
      ),
    ).rejects.toThrow("active account");
  }
  for (const [id, kind] of [
    [investment, "investment"],
    [pension, "pension"],
  ] as const)
    await service.saveAccount(owner, { id, name: kind, kind, archived: true, expectedVersion: 1 });
  await store.connections.save(owner, broker, { ...connection, disconnected: true, version: 2 }, 1);
  // Existing references remain editable one at a time, but no new line can select them.
  await service.saveBudget(owner, { ...plan, salary: pence(310000) }, 1);
  const retired = await service.bootstrap(owner);
  expect(retired.budgetTargets).toEqual(
    expect.arrayContaining([
      { id: investment, kind: "investment" },
      { id: pension, kind: "pension" },
      { id: broker, kind: "investment" },
    ]),
  );
  expect(retired.budgetSummary).toMatchObject({ investmentSavings: 20000, pensionSavings: 10000 });
  for (const id of [investment, pension, broker])
    await expect(
      service.saveBudget(
        owner,
        {
          ...plan,
          savingsAllocations: [
            { ...plan.savingsAllocations[0]!, id: randomUUID(), destinationId: id },
          ],
        },
        2,
      ),
    ).rejects.toThrow("active account");
  await service.saveBudget(
    owner,
    {
      ...plan,
      savingsAllocations: plan.savingsAllocations.map((line) => ({ ...line, destinationId: null })),
    },
    2,
  );
});

async function enduteFixture(owner = randomUUID()) {
  const { EnduteService } = await import("../application/endute-service");
  const { LocalCredentialCipher } = await import("../auth/encryption");
  const { vi } = await import("vitest");
  const cipher = new LocalCredentialCipher(Buffer.alloc(32, 5).toString("base64"));
  const value: import("../integrations/endute").EnduteValuation = {
    balances: [
      {
        id: "bank",
        parentAccountId: "bank",
        name: "Savings",
        type: "account",
        kind: "cash",
        balance: pence(120000),
        fetchedAt: "2026-09-27T10:00:00Z",
      },
      {
        id: "card",
        parentAccountId: "card",
        name: "Credit card",
        type: "account",
        kind: "debt",
        balance: pence(-10000),
        fetchedAt: "2026-09-28T09:00:00Z",
      },
    ],
    accountIds: ["bank", "card"],
    warnings: [],
    fetchedAt: "2026-09-27T10:00:00Z",
  };
  const provider = { value: vi.fn(async () => structuredClone(value)) };
  const service = new EnduteService(
    store,
    provider,
    cipher,
    () => new Date("2026-09-28T12:00:00Z"),
  );
  const bank = await service.connect(owner, { apiKey: "private-endute-key", expectedVersion: 0 });
  return { owner, service, provider, cipher, value, bank };
}

it("encrypts and isolates Endute keys, rotates in place, and reconnects after disconnection", async () => {
  const f = await enduteFixture();
  expect(f.bank).not.toHaveProperty("encryptedCredentials");
  const stored = (await store.banks.get(f.owner, "endute"))!;
  expect(stored.data.encryptedCredentials).not.toContain("private-endute-key");
  expect(
    await f.cipher.decrypt(stored.data.encryptedCredentials!, `${f.owner}/endute/endute`),
  ).toContain("private-endute-key");
  await expect(f.service.refresh("another-user", "endute")).rejects.toThrow("not found");
  await f.service.select(f.owner, "endute", ["bank", "card"], f.bank.version);
  const original = await store.accounts.list(f.owner);
  const rotated = await f.service.connect(f.owner, {
    apiKey: "replacement-key",
    expectedVersion: 2,
  });
  expect((await store.accounts.list(f.owner)).map((record) => record.id).sort()).toEqual(
    original.map((record) => record.id).sort(),
  );
  await f.service.refresh(f.owner, "endute");
  expect(f.provider.value).toHaveBeenLastCalledWith("replacement-key");
  await expect(f.service.disconnect(f.owner, "endute", rotated.version)).rejects.toThrow("changed");
  const latest = (await store.banks.get(f.owner, "endute"))!;
  await f.service.disconnect(f.owner, "endute", latest.version);
  expect((await store.banks.get(f.owner, "endute"))?.data.encryptedCredentials).toBeNull();
  for (const record of await store.accounts.list(f.owner)) {
    expect(record.data.automation).toBeUndefined();
    expect(record.data.workingBalance).toBe(
      original.find((old) => old.id === record.id)!.data.workingBalance,
    );
  }
  expect((await f.service.connect(f.owner, { apiKey: "new-key", expectedVersion: 0 })).status).toBe(
    "ready",
  );
});

it("preserves Endute identity on deselection, rejects changed ownership and cross-provider requests", async () => {
  const f = await enduteFixture();
  await f.service.select(f.owner, "endute", ["bank"], f.bank.version);
  const account = (await store.accounts.list(f.owner))[0]!;
  await f.service.select(f.owner, "endute", [], 2);
  expect((await store.accounts.get(f.owner, account.id))?.data.archived).toBe(true);
  await f.service.select(f.owner, "endute", ["bank"], 3);
  expect((await store.accounts.get(f.owner, account.id))?.data.archived).toBe(false);
  f.provider.value.mockResolvedValueOnce({ ...f.value, accountIds: ["someone-else"] });
  await expect(
    f.service.connect(f.owner, { apiKey: "wrong-owner", expectedVersion: 4 }),
  ).rejects.toThrow("does not expose");
  const monzo = await monzoFixture(f.owner);
  await expect(monzo.service.refresh(f.owner, "endute")).rejects.toThrow("not found");
  const monzoId = await monzo.service.complete(f.owner, "session", monzo.state, "code");
  await expect(f.service.disconnect(f.owner, monzoId, 1)).rejects.toThrow("not found");
});

it("retains balances on incomplete Endute data and archives only truly absent accounts", async () => {
  const f = await enduteFixture();
  await f.service.select(f.owner, "endute", ["bank"], 1);
  const original = (await store.accounts.list(f.owner))[0]!;
  f.provider.value.mockResolvedValueOnce({ ...f.value, balances: [] });
  await expect(f.service.refresh(f.owner, "endute")).rejects.toThrow("no supported GBP balance");
  expect((await store.accounts.get(f.owner, original.id))?.data).toEqual(original.data);
  f.provider.value.mockResolvedValueOnce({ ...f.value, balances: [], accountIds: [] });
  await f.service.refresh(f.owner, "endute");
  expect((await store.accounts.get(f.owner, original.id))?.data).toMatchObject({
    archived: true,
    workingBalance: 120000,
  });
});

it("persists Endute throttling and prevents concurrent refresh or disconnect", async () => {
  const f = await enduteFixture();
  const { EnduteError } = await import("../integrations/endute");
  f.provider.value.mockRejectedValueOnce(new EnduteError("Rate limited", "throttled", 42));
  await expect(f.service.refresh(f.owner, "endute")).rejects.toThrow("Rate limited");
  expect((await store.banks.get(f.owner, "endute"))?.data.retryAt).toBe("2026-09-28T12:00:42.000Z");
  const calls = f.provider.value.mock.calls.length;
  await expect(f.service.refresh(f.owner, "endute")).rejects.toThrow("Wait until");
  expect(f.provider.value).toHaveBeenCalledTimes(calls);
  const stored = (await store.banks.get(f.owner, "endute"))!;
  await store.banks.save(
    f.owner,
    "endute",
    {
      ...stored.data,
      version: stored.version + 1,
      retryAt: null,
      leaseUntil: Date.parse("2026-09-28T12:05:00Z"),
    },
    stored.version,
  );
  await expect(f.service.refresh(f.owner, "endute")).rejects.toThrow("being refreshed");
  await expect(f.service.disconnect(f.owner, "endute", stored.version + 1)).rejects.toThrow("Wait");
});

it("records mixed bank snapshots with per-account Endute timestamps and blocks failed reads", async () => {
  const f = await enduteFixture();
  await f.service.select(f.owner, "endute", ["bank", "card"], 1);
  const monzo = await monzoFixture(f.owner);
  const monzoId = await monzo.service.complete(f.owner, "session", monzo.state, "code");
  const bank = await monzo.service.refresh(f.owner, monzoId);
  await monzo.service.select(f.owner, monzoId, ["pot"], bank.version);
  const { SnapshotService } = await import("../application/snapshot-service");
  const snapshots = new SnapshotService(
    store,
    {
      value: async () => {
        throw new Error("Unused");
      },
      transactions: async () => ({ events: [], nextPage: null }),
      dividends: async () => ({ events: [], nextPage: null }),
    },
    f.cipher,
    () => new Date("2026-09-28T12:00:00Z"),
    monzo.service,
    f.service,
  );
  const input = {
    month: month("2026-09"),
    expectedVersion: 0,
    operationId: randomUUID(),
    replaceConfirmed: false,
    notes: "",
    balances: [],
    periodIncome: null,
    cashPensionContributions: null,
  };
  f.provider.value.mockRejectedValueOnce(new Error("Unavailable"));
  await expect(snapshots.record(f.owner, input)).rejects.toThrow("Unavailable");
  expect(await store.snapshots.list(f.owner)).toHaveLength(0);
  // Promise.all's other bank refresh must finish before retrying the failed snapshot.
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await store.banks.get(f.owner, monzoId))!.data.leaseUntil === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const saved = await snapshots.record(f.owner, input);
  expect(saved.total).toBe(130000);
  expect(saved.balances.find((value) => value.automation?.externalId === "card")).toMatchObject({
    kind: "debt",
    balance: -10000,
    automation: { provider: "endute", fetchedAt: "2026-09-28T09:00:00Z" },
  });
  expect(
    saved.balances.find((value) => value.automation?.externalId === "bank")?.automation?.fetchedAt,
  ).toBe("2026-09-27T10:00:00Z");
  f.provider.value.mockResolvedValue({
    ...f.value,
    balances: f.value.balances.map((value) => ({ ...value, balance: pence(0) })),
  });
  await f.service.refresh(f.owner, "endute");
  expect((await store.snapshots.get(f.owner, input.month))?.data.total).toBe(130000);
});

function enduteTransaction(index: number, date = "2026-09-28") {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    booking_date: date,
    value_date: date,
    amount: "-12.80",
    currency: "GBP",
    description: `Transaction ${index}`,
    counterparty: null,
    enrichment: {
      merchant_name: "Shop",
      category: "Shopping",
      brand_domain: null,
      confidence: null,
      source: null,
    },
    sandbox: false,
  };
}
async function analysisFixture() {
  const f = await enduteFixture();
  const { EnduteTransactionsService } = await import("../application/endute-transactions");
  const { vi } = await import("vitest");
  let time = new Date("2026-09-28T12:00:00Z");
  const provider = {
    accounts: vi.fn<import("../integrations/endute").EnduteTransactionProvider["accounts"]>(
      async () => [{ id: "bank", name: "Savings", institution: "Bank" }],
    ),
    transactions: vi.fn<import("../integrations/endute").EnduteTransactionProvider["transactions"]>(
      async () => ({ results: [enduteTransaction(1)], next: null }),
    ),
  };
  const service = new EnduteTransactionsService(store, provider, f.cipher, () => time);
  return {
    ...f,
    transactionProvider: provider,
    transactions: service,
    setTime: (stamp: string) => {
      time = new Date(stamp);
    },
  };
}
it("imports transactions idempotently, moves corrected dates and paginates server-side with owner isolation", async () => {
  const f = await analysisFixture();
  const rows = Array.from({ length: 65 }, (_, i) => enduteTransaction(i + 1));
  f.transactionProvider.transactions.mockResolvedValue({ results: rows, next: null });
  const result = await f.transactions.sync(f.owner);
  expect(result).toMatchObject({ error: null, backfilling: false });
  const first = await f.transactions.list(f.owner);
  expect(first.rows).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  const next = await f.transactions.list(f.owner, first.nextCursor!);
  expect(next.rows).toHaveLength(15);
  const ids = [...first.rows, ...next.rows].map((row) => row.id);
  expect(new Set(ids).size).toBe(65);
  expect(first.rows[0]).toMatchObject({
    accountId: "bank",
    accountName: "Savings",
    institution: "Bank",
    amount: "-12.80",
  });
  f.setTime("2026-09-28T12:05:00Z");
  await f.transactions.sync(f.owner);
  expect((await store.transactions.list(f.owner, undefined, 100)).rows).toHaveLength(65);
  expect(f.transactionProvider.transactions.mock.calls.at(-1)?.[3]).toBe("2026-09-21");
  f.transactionProvider.transactions.mockResolvedValue({
    results: [
      {
        ...enduteTransaction(1, "2026-09-29"),
        description: "Corrected",
        enrichment: { ...enduteTransaction(1).enrichment, category: "Groceries" },
      },
    ],
    next: null,
  });
  f.setTime("2026-09-28T12:10:00Z");
  await f.transactions.sync(f.owner);
  const corrected = await store.transactions.list(f.owner, undefined, 100);
  expect(corrected.rows).toHaveLength(65);
  expect(corrected.rows[0]).toMatchObject({
    id: enduteTransaction(1).id,
    booking_date: "2026-09-29",
    description: "Corrected",
    enrichment: { category: "Groceries" },
  });
  expect((await store.transactions.list("another-user")).rows).toEqual([]);
  await expect(store.transactions.list("another-user", first.nextCursor!)).rejects.toThrow(
    "Invalid transaction page",
  );
  await expect(f.transactions.list(f.owner, "invalid-cursor")).rejects.toThrow(
    "Invalid transaction page",
  );
});

it("resumes bounded history imports and retains the original window across a long backfill", async () => {
  const f = await analysisFixture();
  f.transactionProvider.accounts.mockResolvedValue([
    { id: "bank", name: "Savings", institution: "Bank" },
    { id: "other", name: "Other", institution: "Bank" },
  ]);
  f.transactionProvider.transactions.mockImplementation(async (_key, account, path) => {
    if (account === "other") return { results: [enduteTransaction(999)], next: null };
    const index = path ? Number(path.split("=")[1]) : 1;
    return { results: [enduteTransaction(index)], next: index < 12 ? `next=${index + 1}` : null };
  });
  const first = await f.transactions.sync(f.owner);
  expect(first?.backfilling).toBe(true);
  expect(f.transactionProvider.transactions).toHaveBeenCalledTimes(10);
  expect((await store.transactions.list(f.owner, undefined, 100)).rows).toHaveLength(10);
  const progress = await store.transactions.state(f.owner);
  expect(progress.accounts.bank?.next).toBe("next=10");
  f.setTime("2026-10-12T12:00:00Z");
  await f.transactions.sync(f.owner);
  expect((await store.transactions.state(f.owner)).accounts.bank).toMatchObject({
    backfillDone: true,
    lastCompletedAt: "2026-09-28T12:00:00.000Z",
  });
  f.transactionProvider.transactions.mockResolvedValue({ results: [], next: null });
  f.setTime("2026-10-12T12:05:00Z");
  await f.transactions.sync(f.owner);
  expect(
    f.transactionProvider.transactions.mock.calls.some(
      (call) => call[1] === "bank" && call[3] === "2026-09-21",
    ),
  ).toBe(true);
});

it("serializes manual and scheduled imports, obeys Retry-After and resumes after provider failure", async () => {
  const f = await analysisFixture();
  const state = await store.transactions.acquire(
    f.owner,
    "busy",
    Date.parse("2026-09-28T12:00:00Z"),
  );
  expect((await f.transactions.sync(f.owner))?.syncing).toBe(true);
  expect(f.transactionProvider.accounts).not.toHaveBeenCalled();
  await store.transactions.checkpoint(f.owner, state!, true);
  const { EnduteError } = await import("../integrations/endute");
  f.transactionProvider.transactions.mockRejectedValueOnce(
    new EnduteError("Rate limited", "throttled", 42),
  );
  expect(await f.transactions.sync(f.owner)).toMatchObject({
    error: "Rate limited",
    retryAt: "2026-09-28T12:00:42.000Z",
    syncing: false,
  });
  const calls = f.transactionProvider.accounts.mock.calls.length;
  await f.transactions.sync(f.owner, true);
  expect(f.transactionProvider.accounts).toHaveBeenCalledTimes(calls);
  f.setTime("2026-09-28T12:01:00Z");
  expect((await f.transactions.sync(f.owner))?.error).toBeNull();
  expect((await f.transactions.list(f.owner)).rows).toHaveLength(1);
});

it("stops transaction access and scheduled imports on disconnect, without deleting saved records", async () => {
  const f = await analysisFixture();
  await f.transactions.sync(f.owner);
  expect((await store.transactions.jobs()).owners).toContain(f.owner);
  await f.service.disconnect(f.owner, "endute", f.bank.version);
  expect((await store.transactions.jobs()).owners).not.toContain(f.owner);
  await expect(f.transactions.status(f.owner)).rejects.toThrow("Connect Endute");
  await expect(f.transactions.list(f.owner)).rejects.toThrow("Connect Endute");
  await expect(f.transactions.sync(f.owner)).rejects.toThrow("Connect Endute");
  expect(await f.transactions.sync(f.owner, true)).toBeNull();
  expect((await store.transactions.list(f.owner)).rows).toHaveLength(1);
});

it("rejects imports from expired leases and keys rotated during a transaction read", async () => {
  const f = await analysisFixture();
  const old = await store.transactions.acquire(f.owner, "old", 100);
  const newer = await store.transactions.acquire(f.owner, "new", 150101);
  const row = {
    ...enduteTransaction(1),
    accountId: "bank",
    accountName: "Bank",
    institution: "Bank",
    importedAt: "2026-09-28T12:00:00Z",
  };
  await expect(store.transactions.putPage(f.owner, [row], "old")).rejects.toHaveProperty(
    "name",
    "ConflictError",
  );
  await expect(store.transactions.checkpoint(f.owner, old!, true)).rejects.toSatisfy((error) =>
    hasErrorName(error, "ConditionalCheckFailedException"),
  );
  await store.transactions.checkpoint(f.owner, newer!, true);
  f.transactionProvider.transactions.mockImplementationOnce(async () => {
    await f.service.connect(f.owner, { apiKey: "rotated", expectedVersion: f.bank.version });
    return { results: [enduteTransaction(1)], next: null };
  });
  expect((await f.transactions.sync(f.owner))?.error).toContain("could not finish");
  expect((await store.transactions.list(f.owner)).rows).toHaveLength(0);
});

it("categorises queued imports, preserves manual choices and rejects stale batch results", async () => {
  const { CategorisationService } = await import("../application/categorisation");
  const { emptySync } = await import("./endute-transactions");
  const { GeminiError } = await import("../integrations/gemini");
  const owner = `category-${randomUUID()}`,
    accountId = randomUUID(),
    transactionId = randomUUID();
  const category = { id: randomUUID(), name: "Groceries", description: "Supermarkets" };
  await store.banks.save(
    owner,
    "endute",
    {
      id: "endute",
      provider: "endute",
      name: "Endute",
      encryptedCredentials: "encrypted",
      disconnected: false,
      version: 1,
      accountIds: [],
      selectedExternalIds: [],
      lastRefreshedAt: null,
    } as unknown as import("@wealth/domain").BankConnection,
    0,
  );
  const row: import("./endute-transactions").StoredEnduteTransaction = {
    id: transactionId,
    accountId,
    accountName: "Monzo",
    institution: "Monzo",
    booking_date: "2026-09-30",
    value_date: null,
    amount: "-12.00",
    currency: "GBP",
    description: "Tesco",
    counterparty: null,
    enrichment: {
      merchant_name: "Tesco",
      category: "Old provider label",
      brand_domain: null,
      confidence: null,
      source: null,
    },
    sandbox: false,
    importedAt: "2026-09-30T12:00:00Z",
  };
  const lease = (await store.transactions.acquire(owner, "import", Date.now()))!;
  await store.transactions.putPage(owner, [row], "import");
  await store.transactions.checkpoint(owner, { ...emptySync(), ...lease }, true);
  expect((await store.categorisation.pending(owner)).items).toHaveLength(1);
  let done = false,
    submissions = 0;
  const provider: import("../integrations/gemini").CategorisationProvider = {
    submit: async () => {
      submissions++;
      return `batches/job${submissions}`;
    },
    get: async (name) => ({ name, done, failed: false, results: new Map([["tx_0", category.id]]) }),
    find: async () => null,
  };
  const service = new CategorisationService(store, provider, true);
  await service.save(owner, {
    categories: [{ ...category, budgetCategory: " Food " }],
    expectedVersion: 0,
    recategorise: false,
  });
  expect((await store.categorisation.config(owner)).categories).toEqual([
    { id: category.id, name: category.name, budgetCategory: "Food" },
  ]);
  expect((await service.status(owner)).categories).toEqual([
    { id: category.id, name: category.name, budgetCategory: "Food" },
  ]);
  await service.work(owner);
  expect(submissions).toBe(1);
  expect((await service.status(owner)).processing).toBe(1);
  done = true;
  await service.work(owner);
  const first = (await service.list(owner)).rows[0]!;
  expect(first.customCategory).toBe("Groceries");
  expect(first.enrichment.category).toBe("Old provider label");
  expect(first.categorisationStatus).toBe("complete");
  expect((await store.categorisation.pending(owner)).items).toHaveLength(0);
  expect(await service.list("other-owner").catch(() => null)).toBeNull();
  await service.manual(owner, {
    accountId,
    transactionId,
    categoryId: category.id,
    expectedVersion: first.classification!.version,
  });
  await service.recategorise(owner, 1);
  await service.work(owner);
  expect(submissions).toBe(1);
  expect((await service.list(owner)).rows[0]!.categorisationStatus).toBe("manual");

  const second = { ...row, id: randomUUID(), description: "Sainsbury" };
  const secondLease = (await store.transactions.acquire(owner, "import2", Date.now()))!;
  await store.transactions.putPage(owner, [second], "import2");
  await store.transactions.checkpoint(owner, secondLease, true);
  done = false;
  await service.work(owner);
  expect(submissions).toBe(2);
  await service.save(owner, {
    categories: [{ ...category, name: "Food" }],
    expectedVersion: 2,
    recategorise: true,
  });
  done = true;
  await service.work(owner);
  expect(
    (await service.list(owner)).rows.find((r) => r.id === second.id)!.classification,
  ).toBeNull();
  await service.work(owner);
  expect((await service.list(owner)).rows.find((r) => r.id === second.id)!.customCategory).toBe(
    "Food",
  );

  const third = { ...row, id: randomUUID(), description: "Unknown" };
  const thirdLease = (await store.transactions.acquire(owner, "import3", Date.now()))!;
  await store.transactions.putPage(owner, [third], "import3");
  await store.transactions.checkpoint(owner, thirdLease, true);
  provider.submit = async () => {
    submissions++;
    throw new GeminiError("timeout", true);
  };
  await service.work(owner);
  const count = submissions;
  await service.work(owner);
  expect(submissions).toBe(count);
  expect((await service.status(owner)).uncertain).toBe(true);
  // Reconciling the accepted submission resumes collection without another POST.
  provider.find = async () => "batches/reconciled";
  await service.work(owner);
  expect(submissions).toBe(count);
  expect((await service.list(owner)).rows.find((r) => r.id === third.id)!.customCategory).toBe(
    "Food",
  );
});

it("rejects classification for a changed transaction and enforces a global batch limit", async () => {
  const owner = `category-race-${randomUUID()}`,
    accountId = randomUUID(),
    transactionId = randomUUID();
  const category = { id: randomUUID(), name: "Food", description: "" };
  const row: import("./endute-transactions").StoredEnduteTransaction = {
    id: transactionId,
    accountId,
    accountName: "Bank",
    institution: "Bank",
    booking_date: "2026-09-30",
    value_date: null,
    amount: "-12.00",
    currency: "GBP",
    description: "Shop",
    counterparty: null,
    enrichment: {
      merchant_name: null,
      category: null,
      brand_domain: null,
      confidence: null,
      source: null,
    },
    sandbox: false,
    importedAt: "now",
  };
  const config = await store.categorisation.save(owner, [category], 0, false);
  const lease = (await store.transactions.acquire(owner, "race", Date.now()))!;
  await store.transactions.putPage(owner, [row], "race");
  const pending = (await store.categorisation.pending(owner)).items[0]!;
  const batch: import("./categorisation").ClassificationBatch = {
    id: randomUUID(),
    displayName: "race",
    providerName: null,
    phase: "prepared",
    version: config.version,
    generation: config.generation,
    model: "gemini-3.1-flash-lite",
    createdAt: "now",
    items: [pending],
  };
  await store.transactions.putPage(owner, [{ ...row, amount: "-15.00" }], "race");
  expect(await store.categorisation.apply(owner, batch, pending, category.id)).toBe(false);
  expect((await store.categorisation.pending(owner)).items[0]!.digest).not.toBe(pending.digest);
  await store.transactions.checkpoint(owner, lease, true);
  const reserved: string[] = [];
  for (let index = 0; index < 10; index++) {
    const id = randomUUID();
    expect(await store.categorisation.reserve(owner, { ...batch, id })).toBe(true);
    reserved.push(id);
  }
  expect(await store.categorisation.reserve("another-user", { ...batch, id: randomUUID() })).toBe(
    false,
  );
  for (const id of reserved) await store.categorisation.finish(owner, id);
});

it("queries the selected month across pages without leaking adjacent dates or another owner's cursors", async () => {
  const f = await analysisFixture();
  f.transactionProvider.transactions.mockResolvedValue({
    results: [
      ...Array.from({ length: 65 }, (_, i) =>
        enduteTransaction(i + 1, i === 0 ? "2026-09-01" : "2026-09-30"),
      ),
      enduteTransaction(900, "2026-08-31"),
      enduteTransaction(901, "2026-10-01"),
    ],
    next: null,
  });
  await f.transactions.sync(f.owner);
  const range = { from: "2026-09-01", to: "2026-09-30" };
  const first = await f.transactions.list(f.owner, undefined, range);
  const second = await f.transactions.list(f.owner, first.nextCursor!, range);
  expect([...first.rows, ...second.rows]).toHaveLength(65);
  expect(second.nextCursor).toBeNull();
  expect(second.rows.some((row) => row.booking_date === "2026-09-01")).toBe(true);
  expect(first.rows.every((row) => row.booking_date === "2026-09-30")).toBe(true);
  await expect(
    store.transactions.list("another-owner", first.nextCursor!, 50, range),
  ).rejects.toThrow("Invalid transaction page");
  await expect(
    store.transactions.list(f.owner, first.nextCursor!, 50, {
      from: "2026-08-01",
      to: "2026-08-31",
    }),
  ).rejects.toThrow("Invalid transaction page");
  const { CategorisationService } = await import("../application/categorisation");
  const service = new CategorisationService(
    store,
    {
      submit: async () => "",
      get: async () => ({ name: "", done: false, failed: false, results: new Map() }),
      find: async () => null,
    },
    false,
  );
  const excluded = enduteTransaction(1, "2026-09-01");
  const exclusion = { accountId: "bank", transactionId: excluded.id, excluded: true };
  await expect(f.transactions.exclude("another-owner", exclusion)).rejects.toThrow(
    "Connect Endute",
  );
  await expect(
    store.transactions.exclude("another-owner", `bank#${excluded.id}`, true),
  ).rejects.toThrow("Transaction not found");
  await f.transactions.exclude(f.owner, exclusion);
  // A changed re-import must keep the user's exclusion.
  f.transactionProvider.transactions.mockResolvedValue({
    results: [{ ...excluded, description: "Changed" }],
    next: null,
  });
  await f.transactions.sync(f.owner);
  const ledger = await service.ledger(f.owner, range);
  expect(ledger.nextCursor).toBeNull();
  expect(ledger.entries).toHaveLength(64);
  expect(ledger.entries.every((entry) => entry.amount === -1280)).toBe(true);
  expect(ledger.entries.some((entry) => entry.key === `bank#${excluded.id}`)).toBe(false);
  const changed = (await service.list(f.owner, undefined, range, 100)).rows.find(
    (row) => row.id === excluded.id,
  );
  expect(changed).toMatchObject({ description: "Changed", excluded: true });
  expect(ledger.entries[0]).toMatchObject({ categoryId: null, category: null });
  await expect(service.ledger("another-owner", range)).rejects.toThrow("Connect Endute");

  const groceries = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Groceries",
    budgetCategory: null,
  };
  await store.categorisation.save(f.owner, [groceries], 0, false);
  await expect(
    service.saveRule(f.owner, {
      merchant: "Shop",
      description: null,
      action: { type: "category", categoryId: "22222222-2222-4222-8222-222222222222" },
    }),
  ).rejects.toThrow("existing category");
  await service.saveRule(f.owner, {
    merchant: " shop ",
    description: null,
    action: { type: "category", categoryId: groceries.id },
  });
  const third = enduteTransaction(3, "2026-09-01");
  await service.saveRule(f.owner, {
    merchant: "Shop",
    description: "transaction  3",
    action: { type: "exclude" },
  });
  const fourth = enduteTransaction(4, "2026-09-01");
  await service.manual(f.owner, {
    accountId: "bank",
    transactionId: fourth.id,
    categoryId: null,
    expectedVersion: 0,
  });
  const ruled = async () =>
    new Map((await service.list(f.owner, undefined, range, 100)).rows.map((row) => [row.id, row]));
  let rows = await ruled();
  expect(rows.get(enduteTransaction(2, "2026-09-01").id)).toMatchObject({
    customCategory: "Groceries",
    categorisationStatus: "rule",
    excluded: false,
  });
  // The more specific rule wins, and a manual choice beats any rule.
  expect(rows.get(third.id)).toMatchObject({ excluded: true, customCategory: null });
  expect(rows.get(fourth.id)).toMatchObject({
    customCategory: null,
    categorisationStatus: "manual",
  });
  expect(rows.get(excluded.id)).toMatchObject({ excluded: true, customCategory: "Groceries" });
  await f.transactions.exclude(f.owner, {
    accountId: "bank",
    transactionId: third.id,
    excluded: false,
  });
  expect((await ruled()).get(third.id)).toMatchObject({ excluded: false });
  const saved = await service.rules(f.owner);
  expect(saved.map((rule) => [rule.merchant, rule.description]).sort()).toEqual([
    ["Shop", "transaction  3"],
    ["shop", null],
  ]);
  for (const rule of saved) await service.deleteRule(f.owner, rule.id, rule.version);
  rows = await ruled();
  expect(rows.get(enduteTransaction(2, "2026-09-01").id)).toMatchObject({
    customCategory: null,
    categorisationStatus: "pending",
  });
  await expect(service.rules("another-owner")).rejects.toThrow("Connect Endute");
});
