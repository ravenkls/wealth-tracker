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
