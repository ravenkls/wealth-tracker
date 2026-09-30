import type { EnduteTransactionStore } from "../storage/endute-transactions";
import type { EnduteTransactionsService } from "./endute-transactions";
import type { EnduteSyncEvent } from "./endute-scheduler";
import { expect, it, vi } from "vitest";
import { runEnduteSchedule } from "./endute-scheduler";
it("dispatches a bounded registry page and queues the continuation without scanning financial records", async () => {
  const jobs = vi.fn<EnduteTransactionStore["jobs"]>(async () => ({
    owners: ["a", "b"],
    next: "b",
  }));
  const sync = vi.fn<EnduteTransactionsService["sync"]>(async () => null);
  const enqueue = vi.fn<(event: EnduteSyncEvent) => Promise<void>>(async () => {});
  await runEnduteSchedule({ kind: "dispatch" }, { jobs }, { sync }, enqueue);
  expect(enqueue.mock.calls).toEqual([
    [{ kind: "sync", owner: "a" }],
    [{ kind: "sync", owner: "b" }],
    [{ kind: "dispatch", after: "b" }],
  ]);
  expect(sync).not.toHaveBeenCalled();
  await runEnduteSchedule({ kind: "dispatch", after: "b" }, { jobs }, { sync }, enqueue);
  expect(jobs).toHaveBeenLastCalledWith("b");
});
it("syncs only the dispatched owner and rejects malformed jobs", async () => {
  const jobs = vi.fn<EnduteTransactionStore["jobs"]>(async () => ({ owners: [], next: undefined }));
  const sync = vi.fn<EnduteTransactionsService["sync"]>(async () => null);
  const enqueue = vi.fn<(event: EnduteSyncEvent) => Promise<void>>(async () => {});
  await runEnduteSchedule({ kind: "sync", owner: "a" }, { jobs }, { sync }, enqueue);
  expect(sync).toHaveBeenCalledWith("a", true);
  expect(jobs).not.toHaveBeenCalled();
  await expect(runEnduteSchedule({ kind: "sync" }, { jobs }, { sync }, enqueue)).rejects.toThrow(
    "owner",
  );
});

it("dispatches the independent category registry so disconnected users can finish existing batches", async () => {
  const jobs = vi.fn<EnduteTransactionStore["jobs"]>(async () => ({ owners: [], next: undefined }));
  const sync = vi.fn<EnduteTransactionsService["sync"]>(async () => null);
  const enqueue = vi.fn<(event: EnduteSyncEvent) => Promise<void>>(async () => {});
  const categorise = vi.fn<(owner: string) => Promise<void>>(async () => {});
  const categoryJobs = vi.fn<() => Promise<{ owners: string[]; next: string }>>(async () => ({
    owners: ["disconnected-user"],
    next: "disconnected-user",
  }));
  await runEnduteSchedule(
    { kind: "dispatch" },
    { jobs },
    { sync },
    enqueue,
    categorise,
    categoryJobs,
  );
  expect(enqueue).toHaveBeenCalledWith({ kind: "categorise-dispatch" });
  enqueue.mockClear();
  await runEnduteSchedule(
    { kind: "categorise-dispatch" },
    { jobs },
    { sync },
    enqueue,
    categorise,
    categoryJobs,
  );
  expect(enqueue.mock.calls).toEqual([
    [{ kind: "categorise", owner: "disconnected-user" }],
    [{ kind: "categorise-dispatch", after: "disconnected-user" }],
  ]);
  await runEnduteSchedule(
    { kind: "categorise", owner: "disconnected-user" },
    { jobs },
    { sync },
    enqueue,
    categorise,
    categoryJobs,
  );
  expect(categorise).toHaveBeenCalledWith("disconnected-user");
});
