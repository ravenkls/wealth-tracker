import { randomUUID } from "node:crypto";
import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type { PurchaseCategory } from "../integrations/gemini";
import { ConflictError, hasErrorName } from "./errors";

export interface CategoryConfig {
  version: number;
  categories: PurchaseCategory[];
  generation: string;
}
export interface Classification {
  categoryId: string | null;
  source: "manual" | "gemini";
  version: number;
  generation: string;
  digest: string;
  model: string | null;
  updatedAt: string;
  failed?: boolean;
}
export interface PendingClassification {
  sk: string;
  rowKey: string;
  digest: string;
  attempts: number;
  generation?: string;
}
export interface ClassificationBatch {
  id: string;
  displayName: string;
  providerName: string | null;
  phase: "prepared" | "submitted" | "uncertain";
  version: number;
  generation: string;
  model: string;
  createdAt: string;
  items: PendingClassification[];
  nextIndex?: number;
}
interface Rebuild {
  generation: string;
  cursor?: string;
  done: boolean;
}
export function conditionalFailure(error: unknown) {
  if (hasErrorName(error, "ConditionalCheckFailedException")) return true;
  if (!hasErrorName(error, "TransactionCanceledException")) return false;
  const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
  return (
    !!reasons?.some((r) => r.Code === "ConditionalCheckFailed") &&
    reasons.every((r) => !r.Code || r.Code === "None" || r.Code === "ConditionalCheckFailed")
  );
}
export class CategorisationStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}
  private key(owner: string, kind: string, sk = "STATE") {
    return { pk: `CAT_${kind}#${owner}`, sk };
  }
  private async read<T>(key: { pk: string; sk: string }) {
    return (
      await this.client.send(
        new GetCommand({ TableName: this.table, Key: key, ConsistentRead: true }),
      )
    ).Item as T | undefined;
  }
  async config(owner: string): Promise<CategoryConfig> {
    return (
      (await this.read<CategoryConfig>(this.key(owner, "CONFIG"))) ?? {
        version: 0,
        categories: [],
        generation: "initial",
      }
    );
  }
  async save(
    owner: string,
    categories: PurchaseCategory[],
    expectedVersion: number,
    recategorise: boolean,
  ) {
    const current = await this.config(owner);
    if (current.version !== expectedVersion) throw new ConflictError();
    const generation = recategorise ? randomUUID() : current.generation;
    const value = { version: expectedVersion + 1, categories, generation };
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: { ...this.key(owner, "CONFIG"), ...value },
                ConditionExpression: expectedVersion ? "#v = :v" : "attribute_not_exists(pk)",
                ...(expectedVersion
                  ? {
                      ExpressionAttributeNames: { "#v": "version" },
                      ExpressionAttributeValues: { ":v": expectedVersion },
                    }
                  : {}),
              },
            },
            { Put: { TableName: this.table, Item: { pk: "CAT_JOBS", sk: owner, owner } } },
            ...(recategorise
              ? [
                  {
                    Put: {
                      TableName: this.table,
                      Item: { ...this.key(owner, "REBUILD"), generation, done: false },
                    },
                  },
                ]
              : []),
          ],
        }),
      );
    } catch (error) {
      if (conditionalFailure(error)) throw new ConflictError();
      throw error;
    }
    return value;
  }
  async rebuild(owner: string) {
    return this.read<Rebuild>(this.key(owner, "REBUILD"));
  }
  async rebuildPage(
    owner: string,
    generation: string,
    rows: PendingClassification[],
    cursor: string | null,
  ) {
    for (let offset = 0; offset < rows.length; offset += 20) {
      try {
        await this.client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                ConditionCheck: {
                  TableName: this.table,
                  Key: this.key(owner, "CONFIG"),
                  ConditionExpression: "generation = :g",
                  ExpressionAttributeValues: { ":g": generation },
                },
              },
              ...rows.slice(offset, offset + 20).flatMap((row) => [
                {
                  ConditionCheck: {
                    TableName: this.table,
                    Key: { pk: `ENDUTE_TX_ID#${owner}`, sk: row.sk },
                    ConditionExpression: "digest = :d",
                    ExpressionAttributeValues: { ":d": row.digest },
                  },
                },
                {
                  Put: {
                    TableName: this.table,
                    Item: {
                      ...this.key(owner, "PENDING", row.sk),
                      ...row,
                      generation,
                      attempts: 0,
                    },
                  },
                },
              ]),
            ],
          }),
        );
      } catch (error) {
        if (conditionalFailure(error)) return;
        throw error;
      }
    }
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: this.key(owner, "REBUILD"),
          UpdateExpression: "SET #cursor = :cursor, done = :done",
          ConditionExpression: "generation = :g",
          ExpressionAttributeNames: { "#cursor": "cursor" },
          ExpressionAttributeValues: {
            ":cursor": cursor ?? null,
            ":done": !cursor,
            ":g": generation,
          },
        }),
      );
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }
  async pending(owner: string, limit = 500) {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": this.key(owner, "PENDING").pk },
        Limit: limit,
        ConsistentRead: true,
      }),
    );
    return {
      items: (result.Items ?? []) as PendingClassification[],
      more: !!result.LastEvaluatedKey,
    };
  }
  async classifications(owner: string, ids: string[]) {
    const found = new Map<string, Classification>();
    for (let offset = 0; offset < ids.length; offset += 100) {
      let keys = [...new Set(ids.slice(offset, offset + 100))].map((id) =>
        this.key(owner, "RESULT", id),
      );
      for (let retry = 0; keys.length && retry < 5; retry++) {
        const result = await this.client.send(
          new BatchGetCommand({
            RequestItems: { [this.table]: { Keys: keys, ConsistentRead: true } },
          }),
        );
        for (const item of result.Responses?.[this.table] ?? [])
          found.set(item.sk as string, {
            categoryId: item.categoryId as string | null,
            source: item.source as Classification["source"],
            version: item.version as number,
            generation: item.generation as string,
            digest: item.digest as string,
            model: item.model as string | null,
            updatedAt: item.updatedAt as string,
            failed: Boolean(item.failed),
          });
        keys = (result.UnprocessedKeys?.[this.table]?.Keys ?? []) as typeof keys;
        if (keys.length) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** retry));
      }
      if (keys.length) throw new Error("Custom categories could not be read.");
    }
    return found;
  }
  async removePending(owner: string, row: PendingClassification) {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.table,
          Key: this.key(owner, "PENDING", row.sk),
          ConditionExpression:
            "digest = :d AND (generation = :g OR attribute_not_exists(generation))",
          ExpressionAttributeValues: { ":d": row.digest, ":g": row.generation ?? "initial" },
        }),
      );
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }
  async apply(
    owner: string,
    batch: ClassificationBatch,
    row: PendingClassification,
    categoryId: string | null,
    failed = false,
  ) {
    const previous = (await this.classifications(owner, [row.sk])).get(row.sk);
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: this.table,
                Key: { pk: `ENDUTE_TX_ID#${owner}`, sk: row.sk },
                ConditionExpression: "digest = :d",
                ExpressionAttributeValues: { ":d": row.digest },
              },
            },
            {
              ConditionCheck: {
                TableName: this.table,
                Key: this.key(owner, "CONFIG"),
                ConditionExpression: "#v = :v AND generation = :g",
                ExpressionAttributeNames: { "#v": "version" },
                ExpressionAttributeValues: { ":v": batch.version, ":g": batch.generation },
              },
            },
            {
              Delete: {
                TableName: this.table,
                Key: this.key(owner, "PENDING", row.sk),
                ConditionExpression:
                  "digest = :d AND (generation = :g OR attribute_not_exists(generation))",
                ExpressionAttributeValues: { ":d": row.digest, ":g": batch.generation },
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: {
                  ...this.key(owner, "RESULT", row.sk),
                  categoryId: failed ? (previous?.categoryId ?? null) : categoryId,
                  source: "gemini",
                  version: (previous?.version ?? 0) + 1,
                  generation: batch.generation,
                  digest: row.digest,
                  model: batch.model,
                  updatedAt: new Date().toISOString(),
                  failed,
                },
                ConditionExpression: "attribute_not_exists(pk) OR (#source <> :manual AND #v = :v)",
                ExpressionAttributeNames: { "#source": "source", "#v": "version" },
                ExpressionAttributeValues: { ":manual": "manual", ":v": previous?.version ?? 0 },
              },
            },
          ],
        }),
      );
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }
  async retry(owner: string, row: PendingClassification) {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: this.key(owner, "PENDING", row.sk),
          UpdateExpression: "SET attempts = :a",
          ConditionExpression:
            "digest = :d AND (generation = :g OR attribute_not_exists(generation))",
          ExpressionAttributeValues: {
            ":a": row.attempts + 1,
            ":d": row.digest,
            ":g": row.generation ?? "initial",
          },
        }),
      );
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }
  async manual(
    owner: string,
    id: string,
    categoryId: string | null,
    expectedVersion: number,
    config: CategoryConfig,
  ) {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: this.table,
                Key: this.key(owner, "CONFIG"),
                ConditionExpression: "#v = :v",
                ExpressionAttributeNames: { "#v": "version" },
                ExpressionAttributeValues: { ":v": config.version },
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: {
                  ...this.key(owner, "RESULT", id),
                  categoryId,
                  source: "manual",
                  version: expectedVersion + 1,
                  generation: config.generation,
                  digest: "manual",
                  model: null,
                  updatedAt: new Date().toISOString(),
                },
                ConditionExpression: expectedVersion ? "#v = :v" : "attribute_not_exists(pk)",
                ...(expectedVersion
                  ? {
                      ExpressionAttributeNames: { "#v": "version" },
                      ExpressionAttributeValues: { ":v": expectedVersion },
                    }
                  : {}),
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (conditionalFailure(error)) throw new ConflictError();
      throw error;
    }
  }
  async jobs(after?: string) {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": "CAT_JOBS" },
        Limit: 20,
        ...(after ? { ExclusiveStartKey: { pk: "CAT_JOBS", sk: after } } : {}),
      }),
    );
    return {
      owners: (result.Items ?? []).map((item) => item.owner as string),
      next: result.LastEvaluatedKey?.sk as string | undefined,
    };
  }
  async batches(owner: string) {
    return (
      ((
        await this.client.send(
          new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: { ":pk": this.key(owner, "BATCH").pk },
            Limit: 4,
            ConsistentRead: true,
          }),
        )
      ).Items as ClassificationBatch[]) ?? []
    );
  }
  async saveBatch(owner: string, batch: ClassificationBatch) {
    await this.client.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...this.key(owner, "BATCH", batch.id), ...batch },
      }),
    );
  }
  async reserve(owner: string, batch: ClassificationBatch) {
    const token = randomUUID();
    if (!(await this.acquire("global", token, 30000))) return false;
    try {
      const slots = await this.client.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": "CAT_ACTIVE" },
          Limit: 10,
          ConsistentRead: true,
        }),
      );
      if ((slots.Count ?? 0) >= 10) return false;
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: { ...this.key(owner, "BATCH", batch.id), ...batch },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            { Put: { TableName: this.table, Item: { pk: "CAT_ACTIVE", sk: batch.id, owner } } },
          ],
        }),
      );
      return true;
    } finally {
      await this.release("global", token);
    }
  }
  async finish(owner: string, id: string) {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: this.table, Key: this.key(owner, "BATCH", id) } },
          { Delete: { TableName: this.table, Key: { pk: "CAT_ACTIVE", sk: id } } },
        ],
      }),
    );
  }
  async acquire(owner: string, token: string, duration = 150000) {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: this.key(owner, "WORK"),
          UpdateExpression: "SET leaseUntil = :until, #token = :token",
          ExpressionAttributeNames: { "#token": "token" },
          ConditionExpression: "attribute_not_exists(leaseUntil) OR leaseUntil < :now",
          ExpressionAttributeValues: {
            ":until": Date.now() + duration,
            ":now": Date.now(),
            ":token": token,
          },
        }),
      );
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }
  async release(owner: string, token: string, error: string | null = null, retryDelay = 1800000) {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: this.key(owner, "WORK"),
          UpdateExpression:
            "SET leaseUntil = :zero, #error = :error, lastRunAt = :now, retryAfter = :retry",
          ConditionExpression: "#token = :token",
          ExpressionAttributeNames: { "#error": "error", "#token": "token" },
          ExpressionAttributeValues: {
            ":zero": 0,
            ":error": error,
            ":retry": error ? Date.now() + retryDelay : 0,
            ":now": new Date().toISOString(),
            ":token": token,
          },
        }),
      );
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }
  async workState(owner: string) {
    return this.read<{ error?: string; lastRunAt?: string; retryAfter?: number }>(
      this.key(owner, "WORK"),
    );
  }
}
