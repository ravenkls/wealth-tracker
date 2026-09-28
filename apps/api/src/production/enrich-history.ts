import { readFile, mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { WealthStore } from "../storage/records";
import { WealthService } from "../application/wealth-service";
import { prepareHistoricalSavings } from "../application/historical-savings";
import { operationDigest } from "../application/snapshot-service";
import { nonnegative, period } from "../application/schemas";

const manifestSchema = z.object({
  userId: z.string().regex(/^[a-f0-9]{64}$/),
  connectionIds: z.array(z.string().min(1)).min(1),
  cashCoverageId: z.uuid(),
  monthlyIncome: nonnegative,
  snapshots: z
    .array(
      z.object({
        month: period,
        expectedVersion: z.number().int().positive(),
        operationId: z.uuid(),
      }),
    )
    .min(2),
});
export async function enrichHistory(path: string) {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const documents = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "eu-west-2" }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const store = new WealthStore(documents, "wealth-tracker-production");
  const connections = await store.connections.list(manifest.userId);
  if (
    manifest.connectionIds.some(
      (id) =>
        !connections.some(
          (connection) => connection.id === id && connection.data.history.completedAt,
        ),
    )
  )
    throw new Error("Historical connections must belong to this user and have complete history.");
  const records = await store.snapshots.list(manifest.userId);
  if (
    records.length !== manifest.snapshots.length ||
    manifest.snapshots.some((entry) => !records.some((record) => record.id === entry.month))
  )
    throw new Error("Snapshot set changed; review migration manifest.");
  const backupDirectory = new URL("../../../../.private/", import.meta.url);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    new URL(`historical-savings-before-${Date.now()}.json`, backupDirectory),
    JSON.stringify(records),
    { mode: 0o600, flag: "wx" },
  );
  const ordered = records
    .map((record) => record.data)
    .sort((a, b) => a.month.localeCompare(b.month));
  // Resume against the original immutable revisions, never against partially enriched records.
  const originals = await Promise.all(
    manifest.snapshots.map(async (entry) => {
      const record = records.find((record) => record.id === entry.month)!;
      if (record.version === entry.expectedVersion) return record.data;
      const original = await store.revisions.get(
        `${manifest.userId}/${entry.month}`,
        String(entry.expectedVersion).padStart(10, "0"),
      );
      const receipt = await store.receipt(
        manifest.userId,
        entry.operationId,
        operationDigest("historical-savings", { ...manifest, month: entry.month }),
      );
      if (!original || !receipt || record.version !== receipt.version)
        throw new Error("Snapshot version changed; no correction overwritten.");
      return original.data;
    }),
  );
  const prepared = prepareHistoricalSavings(originals, manifest, new Date());
  for (const snapshot of prepared) {
    const entry = manifest.snapshots.find((row) => row.month === snapshot.month)!;
    const digest = operationDigest("historical-savings", { ...manifest, month: entry.month });
    await store.saveSnapshot(
      manifest.userId,
      snapshot,
      entry.expectedVersion,
      entry.operationId,
      digest,
    );
  }
  const data = await new WealthService(store).bootstrap(manifest.userId);
  for (const original of ordered) {
    const saved = data.snapshots.find((snapshot) => snapshot.month === original.month)!;
    if (
      original.total !== saved.total ||
      original.cash !== saved.cash ||
      original.investmentTotal !== saved.investmentTotal ||
      original.pensions !== saved.pensions
    )
      throw new Error("Historical balance verification failed.");
  }
  const complete = data.metrics.filter((entry) => entry.result.status === "complete");
  if (complete.length !== prepared.length - 1)
    throw new Error("Not all historical intervals could be reconciled; inspect history details.");
  console.log(
    JSON.stringify({
      snapshotsEnriched: prepared.length,
      completeIntervals: complete.length,
      balancesPreserved: true,
      unavailableBaseline: data.metrics[0]?.result.status === "unavailable",
    }),
  );
}
