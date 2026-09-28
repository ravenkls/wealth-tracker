import { expect, it, vi } from "vitest";
import { AutosaveQueue } from "./autosave";
it("serialises edits made during a save using the returned version, including reverting to the original", async () => {
  let complete!: (version: number) => void;
  const write = vi
    .fn<(value: number, version: number) => Promise<number>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValueOnce(3);
  const changed = vi.fn<(status: string, error?: unknown) => void>();
  const queue = new AutosaveQueue<number>(1, 10, write, changed);
  queue.enqueue(20);
  queue.enqueue(30);
  queue.enqueue(10);
  expect(write).toHaveBeenCalledTimes(1);
  complete(2);
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(write).toHaveBeenNthCalledWith(2, 10, 2);
  expect(changed).toHaveBeenLastCalledWith("saved");
});
it("stops queued writes after a conflict instead of overwriting another editor", async () => {
  const error = new Error("conflict");
  const write = vi
    .fn<(value: number, version: number) => Promise<number>>()
    .mockRejectedValue(error);
  const changed = vi.fn<(status: string, error?: unknown) => void>();
  const queue = new AutosaveQueue<number>(1, 10, write, changed);
  queue.enqueue(20);
  queue.enqueue(30);
  await vi.waitFor(() => expect(changed).toHaveBeenCalledWith("error", error));
  queue.enqueue(40);
  expect(write).toHaveBeenCalledTimes(1);
});
