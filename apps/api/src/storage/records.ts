import { CategorisationStore } from "./categorisation";
import { EnduteTransactionStore } from "./endute-transactions";
import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { recordEntity, monzoAttemptEntity } from "./entities";
import { ConflictError, hasErrorName } from "./errors";
import type {
  TablePreferences,
  BudgetPlan,
  CashEvent,
  Connection,
  ManualAccount,
  Snapshot,
  BankConnection,
} from "@wealth/domain";

export interface Stored<T> {
  id: string;
  version: number;
  data: T;
  createdAt: string;
  updatedAt: string;
}
export class Records<T extends object> {
  readonly entity: ReturnType<typeof recordEntity<T>>;
  constructor(name: string, client: DynamoDBDocumentClient, table: string) {
    this.entity = recordEntity<T>(name, client, table);
  }
  async get(owner: string, id: string): Promise<Stored<T> | null> {
    const result = await this.entity.get({ owner, id }).go({ consistent: true });
    return result.data ?? null;
  }
  async list(owner: string): Promise<Stored<T>[]> {
    return (await this.entity.query.primary({ owner }).go({ consistent: true, pages: "all" })).data;
  }
  async save(
    owner: string,
    id: string,
    data: T,
    expectedVersion: number,
    now = new Date(),
  ): Promise<Stored<T>> {
    const previous = expectedVersion ? await this.get(owner, id) : null;
    const record = {
      owner,
      id,
      data,
      version: expectedVersion + 1,
      createdAt: previous?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    try {
      if (expectedVersion === 0) await this.entity.create(record).go();
      else
        await this.entity
          .put(record)
          .where((a, o) => o.eq(a.version, expectedVersion))
          .go();
    } catch (error) {
      if (hasErrorName(error, "ConditionalCheckFailedException")) throw new ConflictError();
      throw error;
    }
    return record;
  }
  async upsertImported(owner: string, id: string, data: T, now: Date) {
    await this.entity
      .upsert({ owner, id, data, updatedAt: now.toISOString() })
      .ifNotExists({ version: 1, createdAt: now.toISOString() })
      .go();
  }
  async remove(owner: string, id: string, expectedVersion: number) {
    try {
      await this.entity
        .delete({ owner, id })
        .where((a, o) => o.eq(a.version, expectedVersion))
        .go();
    } catch (error) {
      if (hasErrorName(error, "ConditionalCheckFailedException")) throw new ConflictError();
      throw error;
    }
  }
}
type TransactionPut = NonNullable<
  NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Put"]
>;
interface SaveReceipt {
  digest: string;
  snapshot: Snapshot;
}
export class WealthStore {
  readonly categorisation: CategorisationStore;
  readonly transactions: EnduteTransactionStore;
  readonly banks: Records<BankConnection>;
  readonly monzoAttempts: ReturnType<typeof monzoAttemptEntity>;
  readonly appearance: Records<{ mode: "dark" | "light" }>;
  readonly preferences: Records<TablePreferences>;
  readonly accounts: Records<ManualAccount>;
  readonly budgets: Records<BudgetPlan>;
  readonly connections: Records<Connection>;
  readonly snapshots: Records<Snapshot>;
  readonly revisions: Records<Snapshot>;
  readonly operations: Records<SaveReceipt>;
  readonly events: Records<CashEvent>;
  constructor(
    private readonly client: DynamoDBDocumentClient,
    table: string,
  ) {
    this.categorisation = new CategorisationStore(client, table);
    this.transactions = new EnduteTransactionStore(client, table);
    this.banks = new Records("bankConnection", client, table);
    this.monzoAttempts = monzoAttemptEntity(client, table);
    this.appearance = new Records("appearance", client, table);
    this.preferences = new Records("preferences", client, table);
    this.accounts = new Records("account", client, table);
    this.budgets = new Records("budget", client, table);
    this.connections = new Records("connection", client, table);
    this.snapshots = new Records("snapshot", client, table);
    this.revisions = new Records("revision", client, table);
    this.operations = new Records("operation", client, table);
    this.events = new Records("event", client, table);
  }
  async saveBankAccounts(
    owner: string,
    bank: BankConnection,
    expectedVersion: number,
    accounts: { data: ManualAccount; expectedVersion: number }[],
  ) {
    if (accounts.length > 90) throw new Error("Too many accounts in one update.");
    const timestamp = new Date().toISOString();
    async function put<T extends object>(
      records: Records<T>,
      id: string,
      data: T,
      version: number,
    ) {
      const values = {
        owner,
        id,
        data,
        version: version + 1,
        createdAt: (await records.get(owner, id))?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      const params =
        version === 0
          ? records.entity.create(values).params()
          : records.entity
              .put(values)
              .where((a, o) => o.eq(a.version, version))
              .params();
      return { Put: params as TransactionPut };
    }
    const writes: NonNullable<TransactWriteCommandInput["TransactItems"]> = await Promise.all([
      put(this.banks, bank.id, bank, expectedVersion),
      ...accounts.map((account) =>
        put(this.accounts, account.data.id, account.data, account.expectedVersion),
      ),
    ]);
    if (bank.provider === "endute") {
      const key = { pk: "ENDUTE_JOBS", sk: owner };
      writes.push(
        bank.disconnected
          ? {
              Delete: {
                TableName: this.banks.entity.get({ owner, id: bank.id }).params().TableName!,
                Key: key,
              },
            }
          : {
              Put: {
                TableName: this.banks.entity.get({ owner, id: bank.id }).params().TableName!,
                Item: { ...key, owner },
              },
            },
      );
    }
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: writes }));
    } catch (error) {
      if (hasErrorName(error, "TransactionCanceledException")) throw new ConflictError();
      throw error;
    }
  }
  async receipt(userId: string, operationId: string, digest: string) {
    const record = await this.operations.get(userId, operationId);
    if (record && record.data.digest !== digest)
      throw new Error("This save operation ID was already used for different inputs.");
    return record?.data.snapshot ?? null;
  }
  async saveSnapshot(
    userId: string,
    snapshot: Snapshot,
    expectedVersion: number,
    operationId: string,
    digest: string,
  ): Promise<Snapshot> {
    const replay = await this.receipt(userId, operationId, digest);
    if (replay) return replay;
    const record = {
      owner: userId,
      id: snapshot.month,
      data: snapshot,
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    };
    const active =
      expectedVersion === 0
        ? this.snapshots.entity.create(record).params()
        : this.snapshots.entity
            .put(record)
            .where((a, o) => o.eq(a.version, expectedVersion))
            .params();
    const revision = this.revisions.entity
      .create({
        ...record,
        owner: `${userId}/${snapshot.month}`,
        id: String(snapshot.version).padStart(10, "0"),
      })
      .params();
    const operation = this.operations.entity
      .create({
        owner: userId,
        id: operationId,
        version: 1,
        data: { digest, snapshot },
        createdAt: snapshot.updatedAt,
        updatedAt: snapshot.updatedAt,
      })
      .params();
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: active as TransactionPut },
            { Put: revision as TransactionPut },
            { Put: operation as TransactionPut },
          ],
        }),
      );
    } catch (error) {
      if (hasErrorName(error, "TransactionCanceledException")) {
        const saved = await this.receipt(userId, operationId, digest);
        if (saved) return saved;
        throw new ConflictError();
      }
      throw error;
    }
    return snapshot;
  }
}
