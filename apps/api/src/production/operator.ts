import { enrichHistory } from "./enrich-history";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { SecretsManagerClient, PutSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { LocalCredentialCipher } from "../auth/encryption";
import { createLocalDatabase } from "../local/database";
import { KmsCredentialCipher } from "./cipher";

type Item = Record<string, unknown> & {
  pk: string;
  sk: string;
  owner?: string;
  id?: string;
  __edb_e__: string;
  data?: Record<string, unknown>;
};
const region = "eu-west-2";
const targetTable = "wealth-tracker-production";
const kinds = new Set([
  "profile",
  "appearance",
  "preferences",
  "account",
  "budget",
  "connection",
  "snapshot",
  "revision",
  "operation",
  "event",
]);
async function scan(client: DynamoDBDocumentClient, table: string): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new ScanCommand({
        TableName: table,
        ConsistentRead: true,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    );
    items.push(...((page.Items ?? []) as Item[]));
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return items.sort((a, b) => `${a.pk}/${a.sk}`.localeCompare(`${b.pk}/${b.sk}`));
}
async function main() {
  const account = JSON.parse(
    execFileSync("aws", ["sts", "get-caller-identity", "--output", "json"], { encoding: "utf8" }),
  ) as { Account: string };
  if (account.Account !== "235607286117") throw new Error("Unexpected AWS account");
  if (process.argv[2] === "enrich-history") {
    if (!process.argv[3]) throw new Error("Supply the private history migration manifest.");
    await enrichHistory(process.argv[3]);
    return;
  }
  if (process.argv[2] === "seed-google") {
    const clientId = process.env.GOOGLE_CLIENT_ID,
      clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Missing Google configuration");
    await new SecretsManagerClient({ region }).send(
      new PutSecretValueCommand({
        SecretId: "wealth-tracker/production/google",
        SecretString: JSON.stringify({ clientId, clientSecret }),
      }),
    );
    console.log("Production Google credentials saved.");
    return;
  }
  if (process.argv[2] !== "migrate") throw new Error("Use seed-google, migrate or enrich-history");
  const key = process.env.LOCAL_ENCRYPTION_KEY;
  if (!key) throw new Error("Missing local encryption key");
  const local = DynamoDBDocumentClient.from(
    createLocalDatabase(`http://127.0.0.1:${process.env.DYNAMODB_PORT ?? "8000"}`),
  );
  const target = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  const localTable = process.env.DYNAMODB_TABLE ?? "wealth-tracker-local";
  const source = (await scan(local, localTable)).filter(
    (item) => !["session", "oauth"].includes(item.__edb_e__),
  );
  const profiles = source.filter((item) => item.__edb_e__ === "profile");
  if (profiles.length !== 1 || !profiles[0]?.owner)
    throw new Error("Expected exactly one local profile");
  const owner = profiles[0].owner;
  const isOwned = (item: Item) =>
    item.owner === owner ||
    (["event", "revision"].includes(item.__edb_e__) &&
      item.owner?.startsWith(`${owner}/`) === true);
  if (source.some((item) => !kinds.has(item.__edb_e__) || !isOwned(item)))
    throw new Error("Unexpected local records; review before migration");
  const backupDirectory = new URL("../../../../.private/", import.meta.url);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    new URL(`migration-${Date.now()}.json`, backupDirectory),
    JSON.stringify(source),
    { mode: 0o600, flag: "wx" },
  );
  const localCipher = new LocalCredentialCipher(key);
  const productionCipher = new KmsCredentialCipher(
    new KMSClient({ region }),
    "alias/wealth-tracker-production",
  );
  const normalized = async (item: Item, production: boolean) => {
    const result = structuredClone(item);
    if (
      result.__edb_e__ === "connection" &&
      typeof result.data?.encryptedCredentials === "string"
    ) {
      result.data.encryptedCredentials = await (
        production ? productionCipher : localCipher
      ).decrypt(result.data.encryptedCredentials, `${owner}/${result.id}`);
    }
    return result;
  };
  // Preflight all conflicts and credential decryption before writing anything.
  const existing = await scan(target, targetTable);
  const owned = existing.filter((item) => isOwned(item) && kinds.has(item.__edb_e__));
  for (const item of owned) {
    const previous = source.find(
      (candidate) => candidate.pk === item.pk && candidate.sk === item.sk,
    );
    if (
      !previous ||
      !isDeepStrictEqual(await normalized(previous, false), await normalized(item, true))
    )
      throw new Error("Production data differs; no records overwritten");
  }
  const prepared: Item[] = [];
  for (const item of source) {
    if (owned.some((record) => record.pk === item.pk && record.sk === item.sk)) continue;
    const next = structuredClone(item);
    if (next.__edb_e__ === "connection" && typeof next.data?.encryptedCredentials === "string") {
      const plaintext = await localCipher.decrypt(
        next.data.encryptedCredentials,
        `${owner}/${next.id}`,
      );
      next.data.encryptedCredentials = await productionCipher.encrypt(
        plaintext,
        `${owner}/${next.id}`,
      );
    }
    prepared.push(next);
  }
  const latest = (await scan(local, localTable)).filter(
    (item) => !["session", "oauth"].includes(item.__edb_e__),
  );
  if (!isDeepStrictEqual(source, latest))
    throw new Error("Local records changed during preparation; retry when edits stop");
  for (const item of prepared) {
    await target.send(
      new PutCommand({
        TableName: targetTable,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      }),
    );
  }
  for (const item of source) {
    const result = await target.send(
      new GetCommand({
        TableName: targetTable,
        Key: { pk: item.pk, sk: item.sk },
        ConsistentRead: true,
      }),
    );
    if (
      !result.Item ||
      !isDeepStrictEqual(await normalized(item, false), await normalized(result.Item as Item, true))
    )
      throw new Error("Migration verification failed");
  }
  const after = (await scan(local, localTable)).filter(
    (item) => !["session", "oauth"].includes(item.__edb_e__),
  );
  if (!isDeepStrictEqual(source, after))
    throw new Error("Local records changed during migration; review before using production");
  const counts: Record<string, number> = {};
  for (const item of source) counts[item.__edb_e__] = (counts[item.__edb_e__] ?? 0) + 1;
  console.log(JSON.stringify({ verified: source.length, newlyCopied: prepared.length, counts }));
}
main().catch((error: unknown) => {
  // Provider responses can contain private data; report only the safe exception type.
  console.error(
    "Operator command failed. Completed steps may remain; retry using the same inputs.",
    error instanceof Error ? error.name : "UnknownError",
    error instanceof Error && error.constructor === Error
      ? error.message
      : "Check operator configuration and AWS permissions.",
  );
  process.exitCode = 1;
});
