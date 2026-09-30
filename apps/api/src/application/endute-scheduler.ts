import { z } from "zod";
import type { EnduteTransactionStore } from "../storage/endute-transactions";
import type { EnduteTransactionsService } from "./endute-transactions";

const eventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dispatch"), after: z.string().min(1).max(200).optional() }),
  z.object({ kind: z.literal("sync"), owner: z.string().min(1).max(200) }),
]);
export type EnduteSyncEvent = z.infer<typeof eventSchema>;
export async function runEnduteSchedule(
  event: unknown,
  store: Pick<EnduteTransactionStore, "jobs">,
  service: Pick<EnduteTransactionsService, "sync">,
  enqueue: (event: EnduteSyncEvent) => Promise<void>,
) {
  const input = eventSchema.parse(event);
  if (input.kind === "sync") {
    await service.sync(input.owner, true);
    return;
  }
  const page = await store.jobs(input.after);
  for (let offset = 0; offset < page.owners.length; offset += 5)
    await Promise.all(
      page.owners.slice(offset, offset + 5).map((owner) => enqueue({ kind: "sync", owner })),
    );
  if (page.next) await enqueue({ kind: "dispatch", after: page.next });
}
