import { CategorisationStore } from "./categorisation";
import { EnduteTransactionStore } from "./endute-transactions";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Service } from "electrodb";
import { analysisEntities, recordEntity, monzoAttemptEntity } from "./entities";
import { ConflictError, hasErrorName } from "./errors";
import type {
  TablePreferences,
  BudgetPlan,
  CashEvent,
  Connection,
  ManualAccount,
  Snapshot,
  BankConnection,
  OverviewSettings,
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
  async upsert(owner: string, id: string, data: T, now = new Date()) {
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
interface SaveReceipt {
  digest: string;
  snapshot: Snapshot;
}
function wealthService(
  client: DynamoDBDocumentClient,
  table: string,
  records: {
    bankConnection: Records<BankConnection>["entity"];
    account: Records<ManualAccount>["entity"];
    snapshot: Records<Snapshot>["entity"];
    revision: Records<Snapshot>["entity"];
    operation: Records<SaveReceipt>["entity"];
  },
) {
  return new Service({ ...analysisEntities({ client, table }), ...records }, { client, table });
}
export type WealthService = ReturnType<typeof wealthService>;
export class WealthStore {
  private readonly service: WealthService;
  readonly categorisation: CategorisationStore;
  readonly transactions: EnduteTransactionStore;
  readonly banks: Records<BankConnection>;
  readonly monzoAttempts: ReturnType<typeof monzoAttemptEntity>;
  readonly appearance: Records<{ mode: "dark" | "light" }>;
  readonly preferences: Records<TablePreferences>;
  readonly overview: Records<OverviewSettings>;
  readonly accounts: Records<ManualAccount>;
  readonly budgets: Records<BudgetPlan>;
  readonly connections: Records<Connection>;
  readonly snapshots: Records<Snapshot>;
  readonly revisions: Records<Snapshot>;
  readonly operations: Records<SaveReceipt>;
  readonly events: Records<CashEvent>;
  constructor(client: DynamoDBDocumentClient, table: string) {
    this.banks = new Records("bankConnection", client, table);
    this.monzoAttempts = monzoAttemptEntity(client, table);
    this.appearance = new Records("appearance", client, table);
    this.preferences = new Records("preferences", client, table);
    this.overview = new Records("overviewSettings", client, table);
    this.accounts = new Records("account", client, table);
    this.budgets = new Records("budget", client, table);
    this.connections = new Records("connection", client, table);
    this.snapshots = new Records("snapshot", client, table);
    this.revisions = new Records("revision", client, table);
    this.operations = new Records("operation", client, table);
    this.events = new Records("event", client, table);
    this.service = wealthService(client, table, {
      bankConnection: this.banks.entity,
      account: this.accounts.entity,
      snapshot: this.snapshots.entity,
      revision: this.revisions.entity,
      operation: this.operations.entity,
    });
    this.categorisation = new CategorisationStore(this.service);
    this.transactions = new EnduteTransactionStore(this.service);
  }
  async saveBankAccounts(
    owner: string,
    bank: BankConnection,
    expectedVersion: number,
    accounts: { data: ManualAccount; expectedVersion: number }[],
  ) {
    if (accounts.length > 90) throw new Error("Too many accounts in one update.");
    const timestamp = new Date().toISOString();
    const values = async <T extends object>(
      records: Records<T>,
      id: string,
      data: T,
      version: number,
    ) => ({
      owner,
      id,
      data,
      version: version + 1,
      createdAt: (await records.get(owner, id))?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    const bankValues = await values(this.banks, bank.id, bank, expectedVersion);
    const accountValues = await Promise.all(
      accounts.map(async (account) => ({
        values: await values(this.accounts, account.data.id, account.data, account.expectedVersion),
        version: account.expectedVersion,
      })),
    );
    const result = await this.service.transaction
      .write((e) => [
        expectedVersion === 0
          ? e.bankConnection.create(bankValues).commit()
          : e.bankConnection
              .put(bankValues)
              .where((a, o) => o.eq(a.version, expectedVersion))
              .commit(),
        ...accountValues.map((account) =>
          account.version === 0
            ? e.account.create(account.values).commit()
            : e.account
                .put(account.values)
                .where((a, o) => o.eq(a.version, account.version))
                .commit(),
        ),
        ...(bank.provider !== "endute"
          ? []
          : bank.disconnected
            ? [e.enduteJob.delete({ owner }).commit()]
            : [e.enduteJob.put({ owner }).commit()]),
      ])
      .go();
    if (result.canceled) throw new ConflictError();
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
    const revision = {
      ...record,
      owner: `${userId}/${snapshot.month}`,
      id: String(snapshot.version).padStart(10, "0"),
    };
    const operation = {
      owner: userId,
      id: operationId,
      version: 1,
      data: { digest, snapshot },
      createdAt: snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
    };
    const result = await this.service.transaction
      .write((e) => [
        expectedVersion === 0
          ? e.snapshot.create(record).commit()
          : e.snapshot
              .put(record)
              .where((a, o) => o.eq(a.version, expectedVersion))
              .commit(),
        e.revision.create(revision).commit(),
        e.operation.create(operation).commit(),
      ])
      .go();
    if (result.canceled) {
      const saved = await this.receipt(userId, operationId, digest);
      if (saved) return saved;
      throw new ConflictError();
    }
    return snapshot;
  }
}
