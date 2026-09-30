import type { WealthService } from "./application/wealth-service";
import type { ConnectionService } from "./application/connection-service";
import type { SnapshotService } from "./application/snapshot-service";
import { expect, it, vi } from "vitest";
import { createRouter } from "./router";
import { readLocalConfig } from "./local/config";
import { createLocalDatabase } from "./local/database";

it("reports database unavailability without pretending the stack is ready", async () => {
  const caller = createRouter({
    ...mockServices(),
    isDatabaseReady: async () => false,
  }).createCaller({
    user: null,
    trustedOrigin: true,
  });
  expect(await caller.health()).toEqual({ api: "ready", database: "unavailable" });
});
it("reports a ready database", async () => {
  const caller = createRouter({
    ...mockServices(),
    isDatabaseReady: async () => true,
  }).createCaller({
    user: null,
    trustedOrigin: true,
  });
  expect(await caller.health()).toEqual({ api: "ready", database: "ready" });
});
it("refuses production and nonlocal database endpoints", () => {
  expect(() => readLocalConfig({ NODE_ENV: "production" })).toThrow("cannot run in production");
  expect(() => createLocalDatabase("https://dynamodb.eu-west-2.amazonaws.com")).toThrow(
    "loopback HTTP endpoint",
  );
  expect(() => readLocalConfig({ API_PORT: "invalid" })).toThrow("API_PORT");
});

function mockServices() {
  return {
    wealth: {
      appearance: vi.fn<WealthService["appearance"]>(),
      saveAppearance: vi.fn<WealthService["saveAppearance"]>(),
      bootstrap: vi.fn<WealthService["bootstrap"]>(),
      savePreferences: vi.fn<WealthService["savePreferences"]>(),
      saveAccount: vi.fn<WealthService["saveAccount"]>(),
      saveBudget: vi.fn<WealthService["saveBudget"]>(),
      revisions: vi.fn<WealthService["revisions"]>(),
    },
    connections: {
      setDisplayMode: vi.fn<ConnectionService["setDisplayMode"]>(),
      connect: vi.fn<ConnectionService["connect"]>(),
      disconnect: vi.fn<ConnectionService["disconnect"]>(),
      refreshValue: vi.fn<ConnectionService["refreshValue"]>(),
      restartHistory: vi.fn<ConnectionService["restartHistory"]>(),
      advanceHistory: vi.fn<ConnectionService["advanceHistory"]>(),
    },
    snapshots: {
      record: vi.fn<SnapshotService["record"]>(),
      historical: vi.fn<SnapshotService["historical"]>(),
      inlineCorrect: vi.fn<SnapshotService["inlineCorrect"]>(),
      correct: vi.fn<SnapshotService["correct"]>(),
    },
  };
}
it("rejects unauthenticated private reads", async () => {
  const caller = createRouter({
    ...mockServices(),
    isDatabaseReady: async () => true,
  }).createCaller({ user: null, trustedOrigin: true });
  await expect(caller.bootstrap()).rejects.toThrow("Sign in");
});
it("rejects cross-origin mutations before touching records", async () => {
  const services = mockServices();
  const caller = createRouter({ ...services, isDatabaseReady: async () => true }).createCaller({
    user: { userId: "user", profile: { name: "User", email: "user@example.test" } },
    trustedOrigin: false,
  });
  await expect(
    caller.accounts.save({
      id: "d287475a-ad26-42f5-bbef-59668b38c78f",
      name: "Cash",
      kind: "cash",
      archived: false,
      expectedVersion: 0,
    }),
  ).rejects.toThrow("origin");
  expect(services.wealth.saveAccount).not.toHaveBeenCalled();
});

it("protects appearance preferences and validates theme choices", async () => {
  const services = mockServices();
  const router = createRouter({ ...services, isDatabaseReady: async () => true });
  const anonymous = router.createCaller({ user: null, trustedOrigin: true });
  await expect(anonymous.appearance.get()).rejects.toThrow("Sign in");
  await expect(anonymous.appearance.save({ mode: "light", expectedVersion: 0 })).rejects.toThrow(
    "Sign in",
  );
  const user = { userId: "theme-user", profile: { name: "User", email: "user@example.test" } };
  const untrusted = router.createCaller({ user, trustedOrigin: false });
  await expect(untrusted.appearance.save({ mode: "light", expectedVersion: 0 })).rejects.toThrow(
    "origin",
  );
  const caller = router.createCaller({ user, trustedOrigin: true });
  await expect(
    caller.appearance.save({ mode: "system" as "light", expectedVersion: 0 }),
  ).rejects.toThrow("Invalid option");
  expect(services.wealth.saveAppearance).not.toHaveBeenCalled();
  services.wealth.saveAppearance.mockResolvedValue({ mode: "light", version: 1 });
  expect(await caller.appearance.save({ mode: "light", expectedVersion: 0 })).toEqual({
    mode: "light",
    version: 1,
  });
  expect(services.wealth.saveAppearance).toHaveBeenCalledWith("theme-user", "light", 0);
});

it("protects Endute mutations and accepts only the single-key credential contract", async () => {
  const endute = {
    connect: vi.fn<import("./application/endute-service").EnduteService["connect"]>(),
    refresh: vi.fn<import("./application/endute-service").EnduteService["refresh"]>(),
    select: vi.fn<import("./application/endute-service").EnduteService["select"]>(),
    disconnect: vi.fn<import("./application/endute-service").EnduteService["disconnect"]>(),
  };
  const app = createRouter({ ...mockServices(), endute, isDatabaseReady: async () => true });
  const key = `edk_12345678_${"a".repeat(43)}`;
  const input = { apiKey: key, expectedVersion: 0 };
  const user = { userId: "user", profile: { name: "User", email: "user@example.test" } };
  await expect(
    app.createCaller({ user: null, trustedOrigin: true }).endute.connect(input),
  ).rejects.toThrow("Sign in");
  await expect(
    app.createCaller({ user, trustedOrigin: false }).endute.connect(input),
  ).rejects.toThrow("origin");
  const caller = app.createCaller({ user, trustedOrigin: true });
  await expect(caller.endute.connect({ ...input, apiKey: "bad" })).rejects.toThrow("valid Endute");
  expect(endute.connect).not.toHaveBeenCalled();
  await caller.endute.connect(input);
  expect(endute.connect).toHaveBeenCalledWith("user", input);
  const { EnduteError } = await import("./integrations/endute");
  endute.refresh.mockRejectedValueOnce(new EnduteError("Wait before retrying", "throttled", 42));
  await expect(caller.endute.refresh({ id: "endute" })).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  });
});

it("guards Analysis reads and refreshes and keeps pagination scoped to the signed-in user", async () => {
  const analysis = {
    status:
      vi.fn<import("./application/endute-transactions").EnduteTransactionsService["status"]>(),
    list: vi.fn<import("./application/endute-transactions").EnduteTransactionsService["list"]>(
      async () => ({ rows: [], nextCursor: null }),
    ),
    sync: vi.fn<import("./application/endute-transactions").EnduteTransactionsService["sync"]>(),
  };
  const app = createRouter({ ...mockServices(), analysis, isDatabaseReady: async () => true });
  const user = { userId: "owner", profile: { name: "User", email: "user@example.test" } };
  await expect(
    app.createCaller({ user: null, trustedOrigin: true }).analysis.transactions({}),
  ).rejects.toThrow("Sign in");
  await expect(app.createCaller({ user, trustedOrigin: false }).analysis.refresh()).rejects.toThrow(
    "origin",
  );
  expect(analysis.list).not.toHaveBeenCalled();
  expect(analysis.sync).not.toHaveBeenCalled();
  const caller = app.createCaller({ user, trustedOrigin: true });
  await caller.analysis.transactions({ cursor: "page" });
  expect(analysis.list).toHaveBeenCalledWith("owner", "page");
  await caller.analysis.refresh();
  expect(analysis.sync).toHaveBeenCalledWith("owner");
});
