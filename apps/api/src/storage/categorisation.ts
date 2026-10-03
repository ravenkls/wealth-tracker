import { randomUUID } from "node:crypto";
import type { PurchaseCategory } from "../integrations/gemini";
import { ConflictError, hasErrorName } from "./errors";
import { committed, getAll } from "./electro";
import type { WealthService } from "./records";

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
  id: string;
  bookingDate: string;
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
  cursor: string | null;
  done: boolean;
}
export class CategorisationStore {
  private readonly e: WealthService["entities"];
  constructor(private readonly service: WealthService) {
    this.e = service.entities;
  }
  async config(owner: string): Promise<CategoryConfig> {
    const { data } = await this.e.categoryConfig.get({ owner }).go({ consistent: true });
    return data
      ? { version: data.version, categories: data.categories, generation: data.generation }
      : { version: 0, categories: [], generation: "initial" };
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
    const result = await this.service.transaction
      .write((e) => [
        expectedVersion
          ? e.categoryConfig
              .put({ owner, ...value })
              .where((a, o) => o.eq(a.version, expectedVersion))
              .commit()
          : e.categoryConfig.create({ owner, ...value }).commit(),
        e.categoryJob.put({ owner }).commit(),
        ...(recategorise
          ? [e.categoryRebuild.put({ owner, generation, cursor: null, done: false }).commit()]
          : []),
      ])
      .go();
    if (!committed(result)) throw new ConflictError();
    return value;
  }
  async rebuild(owner: string): Promise<Rebuild | undefined> {
    const { data } = await this.e.categoryRebuild.get({ owner }).go({ consistent: true });
    return data
      ? { generation: data.generation, cursor: data.cursor ?? null, done: data.done }
      : undefined;
  }
  async rebuildPage(
    owner: string,
    generation: string,
    rows: PendingClassification[],
    cursor: string | null,
  ) {
    for (let offset = 0; offset < rows.length; offset += 20) {
      const result = await this.service.transaction
        .write((e) => [
          e.categoryConfig
            .check({ owner })
            .where((a, o) => o.eq(a.generation, generation))
            .commit(),
          ...rows.slice(offset, offset + 20).flatMap((row) => [
            e.enduteTransactionId
              .check({ owner, id: row.id })
              .where((a, o) => o.eq(a.digest, row.digest))
              .commit(),
            e.categoryPending.put({ owner, ...row, generation, attempts: 0 }).commit(),
          ]),
        ])
        .go();
      if (!committed(result)) return;
    }
    try {
      await this.e.categoryRebuild
        .patch({ owner })
        .set({ cursor, done: !cursor })
        .where((a, o) => o.eq(a.generation, generation))
        .go();
    } catch (error) {
      if (!hasErrorName(error, "ConditionalCheckFailedException")) throw error;
    }
  }
  async pending(owner: string, limit = 500) {
    const page = await this.e.categoryPending.query
      .primary({ owner })
      .go({ limit, consistent: true });
    return {
      items: page.data.map(({ owner: _owner, ...item }): PendingClassification => item),
      more: !!page.cursor,
    };
  }
  async classifications(owner: string, ids: string[]) {
    const items = await getAll(
      (keys) => this.e.categoryResult.get(keys).go({ consistent: true }),
      [...new Set(ids)].map((id) => ({ owner, id })),
      "Custom categories could not be read.",
    );
    return new Map(
      items.map((item): [string, Classification] => [
        item.id,
        {
          categoryId: item.categoryId ?? null,
          source: item.source,
          version: item.version,
          generation: item.generation,
          digest: item.digest,
          model: item.model ?? null,
          updatedAt: item.updatedAt,
          failed: Boolean(item.failed),
        },
      ]),
    );
  }
  async removePending(owner: string, row: PendingClassification) {
    try {
      await this.e.categoryPending
        .delete({ owner, id: row.id })
        .where(
          (a, o) =>
            `${o.eq(a.digest, row.digest)} AND (${o.eq(a.generation, row.generation ?? "initial")} OR ${o.notExists(a.generation)})`,
        )
        .go();
    } catch (error) {
      if (!hasErrorName(error, "ConditionalCheckFailedException")) throw error;
    }
  }
  async apply(
    owner: string,
    batch: ClassificationBatch,
    row: PendingClassification,
    categoryId: string | null,
    failed = false,
  ) {
    const previous = (await this.classifications(owner, [row.id])).get(row.id);
    const result = await this.service.transaction
      .write((e) => [
        e.enduteTransactionId
          .check({ owner, id: row.id })
          .where((a, o) => o.eq(a.digest, row.digest))
          .commit(),
        e.categoryConfig
          .check({ owner })
          .where(
            (a, o) =>
              `${o.eq(a.version, batch.version)} AND ${o.eq(a.generation, batch.generation)}`,
          )
          .commit(),
        e.categoryPending
          .delete({ owner, id: row.id })
          .where(
            (a, o) =>
              `${o.eq(a.digest, row.digest)} AND (${o.eq(a.generation, batch.generation)} OR ${o.notExists(a.generation)})`,
          )
          .commit(),
        e.categoryResult
          .put({
            owner,
            id: row.id,
            categoryId: failed ? (previous?.categoryId ?? null) : categoryId,
            source: "gemini",
            version: (previous?.version ?? 0) + 1,
            generation: batch.generation,
            digest: row.digest,
            model: batch.model,
            updatedAt: new Date().toISOString(),
            failed,
          })
          .where(
            (a, o) =>
              `${o.notExists(a.id)} OR (${o.ne(a.source, "manual")} AND ${o.eq(a.version, previous?.version ?? 0)})`,
          )
          .commit(),
      ])
      .go();
    return committed(result);
  }
  async retry(owner: string, row: PendingClassification) {
    try {
      await this.e.categoryPending
        .patch({ owner, id: row.id })
        .set({ attempts: row.attempts + 1 })
        .where(
          (a, o) =>
            `${o.eq(a.digest, row.digest)} AND (${o.eq(a.generation, row.generation ?? "initial")} OR ${o.notExists(a.generation)})`,
        )
        .go();
    } catch (error) {
      if (!hasErrorName(error, "ConditionalCheckFailedException")) throw error;
    }
  }
  async manual(
    owner: string,
    id: string,
    categoryId: string | null,
    expectedVersion: number,
    config: CategoryConfig,
  ) {
    const item = {
      owner,
      id,
      categoryId,
      source: "manual" as const,
      version: expectedVersion + 1,
      generation: config.generation,
      digest: "manual",
      model: null,
      updatedAt: new Date().toISOString(),
    };
    const result = await this.service.transaction
      .write((e) => [
        e.categoryConfig
          .check({ owner })
          .where((a, o) => o.eq(a.version, config.version))
          .commit(),
        expectedVersion
          ? e.categoryResult
              .put(item)
              .where((a, o) => o.eq(a.version, expectedVersion))
              .commit()
          : e.categoryResult.create(item).commit(),
      ])
      .go();
    if (!committed(result)) throw new ConflictError();
  }
  async jobs(after?: string) {
    const page = await this.e.categoryJob.query
      .primary({})
      .go({ limit: 20, ...(after ? { cursor: after } : {}) });
    return { owners: page.data.map((item) => item.owner), next: page.cursor ?? undefined };
  }
  async batches(owner: string): Promise<ClassificationBatch[]> {
    const page = await this.e.categoryBatch.query
      .primary({ owner })
      .go({ limit: 4, consistent: true });
    return page.data.map(({ owner: _owner, ...batch }) => ({
      ...batch,
      providerName: batch.providerName ?? null,
    }));
  }
  async saveBatch(owner: string, batch: ClassificationBatch) {
    await this.e.categoryBatch.put({ owner, ...batch }).go();
  }
  async reserve(owner: string, batch: ClassificationBatch) {
    const token = randomUUID();
    if (!(await this.acquire("global", token, 30000))) return false;
    try {
      const slots = await this.e.categoryActive.query
        .primary({})
        .go({ limit: 10, consistent: true });
      if (slots.data.length >= 10) return false;
      const result = await this.service.transaction
        .write((e) => [
          e.categoryBatch.create({ owner, ...batch }).commit(),
          e.categoryActive.put({ batchId: batch.id, owner }).commit(),
        ])
        .go();
      if (!committed(result)) throw new Error("Classification batch already exists.");
      return true;
    } finally {
      await this.release("global", token);
    }
  }
  async finish(owner: string, id: string) {
    committed(
      await this.service.transaction
        .write((e) => [
          e.categoryBatch.delete({ owner, id }).commit(),
          e.categoryActive.delete({ batchId: id }).commit(),
        ])
        .go(),
    );
  }
  async acquire(owner: string, token: string, duration = 150000) {
    try {
      await this.e.categoryWork
        .update({ owner })
        .set({ leaseUntil: Date.now() + duration, token })
        .where((a, o) => `${o.notExists(a.leaseUntil)} OR ${o.lt(a.leaseUntil, Date.now())}`)
        .go();
      return true;
    } catch (error) {
      if (hasErrorName(error, "ConditionalCheckFailedException")) return false;
      throw error;
    }
  }
  async release(owner: string, token: string, error: string | null = null, retryDelay = 1800000) {
    try {
      await this.e.categoryWork
        .update({ owner })
        .set({
          leaseUntil: 0,
          error,
          lastRunAt: new Date().toISOString(),
          retryAfter: error ? Date.now() + retryDelay : 0,
        })
        .where((a, o) => o.eq(a.token, token))
        .go();
    } catch (error) {
      if (!hasErrorName(error, "ConditionalCheckFailedException")) throw error;
    }
  }
  async workState(owner: string) {
    const { data } = await this.e.categoryWork.get({ owner }).go({ consistent: true });
    return data
      ? {
          ...(data.error ? { error: data.error } : {}),
          ...(data.lastRunAt ? { lastRunAt: data.lastRunAt } : {}),
          ...(data.retryAfter !== undefined ? { retryAfter: data.retryAfter } : {}),
        }
      : undefined;
  }
}
