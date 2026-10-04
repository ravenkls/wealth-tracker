import { hash } from "../auth/tokens";
import { createConversions } from "electrodb";
import type { EnduteTransaction } from "../integrations/endute";
import { InputError } from "../application/snapshot-service";
import { ConflictError, hasErrorName } from "./errors";
import { committed, getAll } from "./electro";
import type { WealthService } from "./records";

export interface TransactionRange {
  from: string;
  to: string;
}

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
  private readonly e: WealthService["entities"];
  constructor(private readonly service: WealthService) {
    this.e = service.entities;
  }

  async register(owner: string) {
    await this.e.enduteJob.put({ owner }).go();
  }
  async unregister(owner: string) {
    await this.e.enduteJob.delete({ owner }).go();
  }
  async jobs(after?: string) {
    const page = await this.e.enduteJob.query
      .primary({})
      .go({ limit: 20, ...(after ? { cursor: after } : {}) });
    return { owners: page.data.map((item) => item.owner), next: page.cursor ?? undefined };
  }
  async state(owner: string): Promise<TransactionSyncState> {
    const { data } = await this.e.enduteSync.get({ owner }).go({ consistent: true });
    return {
      ...((data?.data as TransactionSyncState | undefined) ?? emptySync()),
      leaseUntil: data?.leaseUntil ?? 0,
    };
  }
  async acquire(owner: string, token: string, now: number): Promise<TransactionSyncState | null> {
    try {
      const { data } = await this.e.enduteSync
        .update({ owner })
        .set({ leaseUntil: now + 150000, leaseToken: token })
        .where((a, o) => `${o.notExists(a.leaseUntil)} OR ${o.lte(a.leaseUntil, now)}`)
        .go({ response: "all_new" });
      return {
        ...((data.data as TransactionSyncState | undefined) ?? emptySync()),
        leaseUntil: now + 150000,
        leaseToken: token,
      };
    } catch (error) {
      if (hasErrorName(error, "ConditionalCheckFailedException")) return null;
      throw error;
    }
  }
  async checkpoint(owner: string, state: TransactionSyncState, release: boolean) {
    const leaseUntil = release ? 0 : state.leaseUntil;
    await this.e.enduteSync
      .update({ owner })
      .set({ data: { ...state, leaseUntil, leaseToken: null }, leaseUntil })
      .where((a, o) => o.eq(a.leaseToken, state.leaseToken))
      .go();
  }
  async putPage(
    owner: string,
    rows: StoredEnduteTransaction[],
    token: string,
    credentials?: string,
  ) {
    // Stable IDs deduplicate overlapping provider pages; date changes move the chronological row.
    const unique = [...new Map(rows.map((row) => [`${row.accountId}#${row.id}`, row])).values()];
    if (!unique.length) return;
    const previous = await this.identities(
      owner,
      unique.map((row) => `${row.accountId}#${row.id}`),
    );
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
    for (let offset = 0; offset < changed.length; offset += 20) {
      const result = await this.service.transaction
        .write((e) => [
          e.enduteSync
            .check({ owner })
            .where((a, o) => o.eq(a.leaseToken, token))
            .commit(),
          ...(credentials
            ? [
                e.bankConnection
                  .check({ owner, id: "endute" })
                  .where(
                    (a, o) =>
                      `${o.name(a.data)}.encryptedCredentials = ${o.value(a.data, credentials as never)} AND ${o.name(a.data)}.disconnected = ${o.value(a.data, false as never)}`,
                  )
                  .commit(),
              ]
            : []),
          ...changed.slice(offset, offset + 20).flatMap((row) => {
            const id = `${row.accountId}#${row.id}`;
            const digest = fingerprints.get(id)!;
            const old = previous.get(id)?.bookingDate;
            return [
              ...(old && old !== row.booking_date
                ? [e.enduteTransaction.delete({ owner, bookingDate: old, id }).commit()]
                : []),
              // Update keeps user-set attributes such as exclusion across re-imports.
              e.enduteTransactionId
                .update({ owner, id })
                .set({ bookingDate: row.booking_date, digest })
                .commit(),
              e.enduteTransaction
                .put({ owner, bookingDate: row.booking_date, id, data: row })
                .commit(),
              e.categoryPending
                .put({ owner, id, bookingDate: row.booking_date, digest, attempts: 0 })
                .commit(),
            ];
          }),
        ])
        .go();
      if (!committed(result)) throw new ConflictError();
    }
  }
  async identities(owner: string, ids: string[]) {
    const items = await getAll(
      (keys) => this.e.enduteTransactionId.get(keys).go({ consistent: true }),
      [...new Set(ids)].map((id) => ({ owner, id })),
      "Transaction identities could not be read.",
    );
    return new Map(
      items.map((item) => [
        item.id,
        { bookingDate: item.bookingDate, digest: item.digest, excluded: item.excluded ?? null },
      ]),
    );
  }
  async exclude(owner: string, id: string, excluded: boolean) {
    try {
      await this.e.enduteTransactionId.patch({ owner, id }).set({ excluded }).go();
    } catch (error) {
      if (hasErrorName(error, "ConditionalCheckFailedException"))
        throw new InputError("Transaction not found.");
      throw error;
    }
  }
  async readRows(owner: string, keys: { id: string; bookingDate: string }[]) {
    const items = await getAll(
      (batch) => this.e.enduteTransaction.get(batch).go({ consistent: true }),
      [...new Map(keys.map(({ id, bookingDate }) => [id, { owner, id, bookingDate }])).values()],
      "Transaction data could not be read.",
    );
    return new Map(items.map((item) => [item.id, item.data as StoredEnduteTransaction]));
  }
  async list(owner: string, cursor?: string, limit = 50, range?: TransactionRange) {
    if (cursor) {
      try {
        // Cursors are client-supplied, so they must stay inside this owner's requested range.
        const start = createConversions(this.e.enduteTransaction).fromCursor.toComposite(cursor);
        if (
          start?.owner !== owner.toLowerCase() ||
          !start.bookingDate ||
          (range && (start.bookingDate < range.from || start.bookingDate > range.to))
        )
          throw new Error();
      } catch {
        throw new InputError("Invalid transaction page cursor. Return to the first page.");
      }
    }
    const query = this.e.enduteTransaction.query.primary({ owner });
    // The upper bound sorts after every transaction key on the final day.
    const page = await (
      range
        ? query.between({ bookingDate: range.from }, { bookingDate: `${range.to}\uffff` })
        : query
    ).go({
      order: "desc",
      consistent: true,
      limit: Math.min(Math.max(limit, 1), 500),
      ...(cursor ? { cursor } : {}),
    });
    return {
      rows: page.data.map((item) => item.data as StoredEnduteTransaction),
      nextCursor: page.cursor ?? null,
    };
  }
}
