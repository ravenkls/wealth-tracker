import { randomUUID } from "node:crypto";
import { CreateTableCommand, DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createLocalDatabase } from "../local/database";
import { DynamoAuthStore } from "../auth/store";
import { WealthStore } from "./records";
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
