import { hash } from "../auth/tokens";
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
import type { EnduteTransaction } from "../integrations/endute";
import { InputError } from "../application/snapshot-service";
import { hasErrorName } from "./errors";

export interface StoredEnduteTransaction extends EnduteTransaction {
  accountId: string;
  accountName: string;
  institution: string;
  importedAt: string;
}
export interface AccountTransactionProgress {
  cycleStartedAt: string | null;
  next: string | null;
  from: string | null;
  lastCompletedAt: string | null;
  backfillDone: boolean;
}
export interface TransactionSyncState {
  accounts: Record<string, AccountTransactionProgress>;
  accountIndex: number;
  lastAttemptAt: string | null;
  lastSyncedAt: string | null;
  error: string | null;
  retryAt: string | null;
  leaseUntil: number;
  leaseToken: string | null;
}
export const emptySync = (): TransactionSyncState => ({
  accounts: {},
  accountIndex: 0,
  lastAttemptAt: null,
  lastSyncedAt: null,
  error: null,
  retryAt: null,
  leaseUntil: 0,
  leaseToken: null,
});

export class EnduteTransactionStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}
  private rows(owner: string) {
    return `ENDUTE_TX#${owner}`;
  }
  private ids(owner: string) {
    return `ENDUTE_TX_ID#${owner}`;
  }
  private stateKey(owner: string) {
    return { pk: `ENDUTE_SYNC#${owner}`, sk: "STATE" };
  }

  async register(owner: string) {
    await this.client.send(
      new PutCommand({ TableName: this.table, Item: { pk: "ENDUTE_JOBS", sk: owner, owner } }),
    );
  }
  async unregister(owner: string) {
    await this.client.send(
      new DeleteCommand({ TableName: this.table, Key: { pk: "ENDUTE_JOBS", sk: owner } }),
    );
  }
  async jobs(after?: string) {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": "ENDUTE_JOBS" },
        Limit: 20,
        ...(after ? { ExclusiveStartKey: { pk: "ENDUTE_JOBS", sk: after } } : {}),
      }),
    );
    return {
      owners: (result.Items ?? []).map((item) => item.owner as string),
      next: result.LastEvaluatedKey?.sk as string | undefined,
    };
  }
  async state(owner: string): Promise<TransactionSyncState> {
    const result = await this.client.send(
      new GetCommand({ TableName: this.table, Key: this.stateKey(owner), ConsistentRead: true }),
    );
    return {
      ...((result.Item?.data as TransactionSyncState) ?? emptySync()),
      leaseUntil: (result.Item?.leaseUntil as number) ?? 0,
    };
  }
  async acquire(owner: string, token: string, now: number): Promise<TransactionSyncState | null> {
    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: this.stateKey(owner),
          UpdateExpression: "SET leaseUntil = :until, leaseToken = :token",
          ConditionExpression: "attribute_not_exists(leaseUntil) OR leaseUntil <= :now",
          ExpressionAttributeValues: { ":until": now + 150000, ":token": token, ":now": now },
          ReturnValues: "ALL_NEW",
        }),
      );
      return {
        ...((result.Attributes?.data as TransactionSyncState) ?? emptySync()),
        leaseUntil: now + 150000,
        leaseToken: token,
      };
    } catch (error) {
      if (hasErrorName(error, "ConditionalCheckFailedException")) return null;
      throw error;
    }
  }
  async checkpoint(owner: string, state: TransactionSyncState, release: boolean) {
    await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: this.stateKey(owner),
        UpdateExpression: "SET #data = :data, leaseUntil = :until",
        ConditionExpression: "leaseToken = :token",
        ExpressionAttributeNames: { "#data": "data" },
        ExpressionAttributeValues: {
          ":data": { ...state, leaseUntil: release ? 0 : state.leaseUntil, leaseToken: null },
          ":until": release ? 0 : state.leaseUntil,
          ":token": state.leaseToken,
        },
      }),
    );
  }
  async putPage(
    owner: string,
    rows: StoredEnduteTransaction[],
    token: string,
    bank?: { key: Record<string, unknown>; credentials: string },
  ) {
    // Stable IDs deduplicate overlapping provider pages; date changes move the chronological row.
    const unique = [...new Map(rows.map((row) => [`${row.accountId}#${row.id}`, row])).values()];
    if (!unique.length) return;
    const keys = unique.map((row) => ({ pk: this.ids(owner), sk: `${row.accountId}#${row.id}` }));
    let pending = keys;
    const previous = new Map<string, { rowKey: string; digest: string | undefined }>();
    for (let attempt = 0; pending.length && attempt < 5; attempt++) {
      const result = await this.client.send(
        new BatchGetCommand({
          RequestItems: { [this.table]: { Keys: pending, ConsistentRead: true } },
        }),
      );
      for (const item of result.Responses?.[this.table] ?? [])
        previous.set(item.sk as string, {
          rowKey: item.rowKey as string,
          digest: item.digest as string | undefined,
        });
      pending = (result.UnprocessedKeys?.[this.table]?.Keys ?? []) as typeof keys;
      if (pending.length) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
    if (pending.length) throw new Error("Transaction identities could not be read.");
    const fingerprints = new Map(
      unique.map((row) => {
        const { importedAt: _importedAt, ...source } = row;
        return [`${row.accountId}#${row.id}`, hash(JSON.stringify(source))];
      }),
    );
    const changed = unique.filter(
      (row) =>
        previous.get(`${row.accountId}#${row.id}`)?.digest !==
        fingerprints.get(`${row.accountId}#${row.id}`),
    );
    for (let offset = 0; offset < changed.length; offset += 25) {
      const writes: NonNullable<
        ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]
      > = [
        {
          ConditionCheck: {
            TableName: this.table,
            Key: this.stateKey(owner),
            ConditionExpression: "leaseToken = :token",
            ExpressionAttributeValues: { ":token": token },
          },
        },
      ];
      if (bank)
        writes.push({
          ConditionCheck: {
            TableName: this.table,
            Key: bank.key,
            ConditionExpression:
              "#data.encryptedCredentials = :credentials AND #data.disconnected = :disconnected",
            ExpressionAttributeNames: { "#data": "data" },
            ExpressionAttributeValues: { ":credentials": bank.credentials, ":disconnected": false },
          },
        });
      for (const row of changed.slice(offset, offset + 25)) {
        const id = `${row.accountId}#${row.id}`;
        const rowKey = `${row.booking_date}#${id}`;
        const old = previous.get(id)?.rowKey;
        if (old && old !== rowKey)
          writes.push({
            Delete: { TableName: this.table, Key: { pk: this.rows(owner), sk: old } },
          });
        writes.push(
          {
            Put: {
              TableName: this.table,
              Item: { pk: this.ids(owner), sk: id, rowKey, digest: fingerprints.get(id) },
            },
          },
          { Put: { TableName: this.table, Item: { pk: this.rows(owner), sk: rowKey, data: row } } },
        );
      }
      await this.client.send(new TransactWriteCommand({ TransactItems: writes }));
    }
  }
  async list(owner: string, cursor?: string, limit = 50) {
    let start: { pk: string; sk: string } | undefined;
    if (cursor) {
      try {
        const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (
          !value ||
          typeof value !== "object" ||
          !("pk" in value) ||
          !("sk" in value) ||
          value.pk !== this.rows(owner) ||
          typeof value.sk !== "string" ||
          !/^\d{4}-\d{2}-\d{2}#/.test(value.sk)
        )
          throw new Error();
        start = { pk: this.rows(owner), sk: value.sk };
      } catch {
        throw new InputError("Invalid transaction page cursor. Return to the first page.");
      }
    }
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": this.rows(owner) },
        ScanIndexForward: false,
        ConsistentRead: true,
        Limit: Math.min(Math.max(limit, 1), 100),
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    );
    return {
      rows: (result.Items ?? []).map((item) => item.data as StoredEnduteTransaction),
      nextCursor: result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
        : null,
    };
  }
}
