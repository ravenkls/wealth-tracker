import { transactionInsights } from "./transaction-insights";
import type { TransactionRange } from "../storage/endute-transactions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GeminiError, type CategorisationProvider } from "../integrations/gemini";
import type { WealthStore } from "../storage/records";
import type { ClassificationBatch } from "../storage/categorisation";
import { InputError } from "./snapshot-service";
import type { StoredEnduteTransaction } from "../storage/endute-transactions";

export const categoriesInput = z
  .object({
    expectedVersion: z.number().int().min(0),
    recategorise: z.boolean().default(false),
    categories: z
      .array(
        z.object({
          id: z.uuid(),
          name: z.string().trim().min(1).max(80),
        }),
      )
      .max(50),
  })
  .superRefine((input, ctx) => {
    if (
      new Set(input.categories.map((c) => c.id)).size !== input.categories.length ||
      new Set(input.categories.map((c) => c.name.toLowerCase())).size !== input.categories.length
    )
      ctx.addIssue({ code: "custom", message: "Category names and IDs must be unique." });
    if (input.recategorise && !input.categories.length)
      ctx.addIssue({ code: "custom", message: "Add a category before recategorising." });
  });
export class CategorisationService {
  constructor(
    private readonly store: WealthStore,
    private readonly provider: CategorisationProvider,
    private readonly configured: boolean,
    private readonly model = "gemini-3.1-flash-lite",
  ) {}
  private async connected(owner: string) {
    const bank = await this.store.banks.get(owner, "endute");
    return !!bank && !bank.data.disconnected && !!bank.data.encryptedCredentials;
  }
  private async requireConnection(owner: string) {
    if (!(await this.connected(owner)))
      throw new InputError("Connect Endute to manage transaction categories.");
  }
  async status(owner: string) {
    await this.requireConnection(owner);
    const [config, pending, batches, rebuild, state] = await Promise.all([
      this.store.categorisation.config(owner),
      this.store.categorisation.pending(owner, 2001),
      this.store.categorisation.batches(owner),
      this.store.categorisation.rebuild(owner),
      this.store.categorisation.workState(owner),
    ]);
    const processing = new Set(
      batches.flatMap((b) => b.items.slice(b.nextIndex ?? 0).map((i) => i.sk)),
    );
    return {
      ...config,
      categories: config.categories.map(({ id, name }) => ({ id, name })),
      configured: this.configured,
      queued: pending.items.filter((i) => !processing.has(i.sk)).length,
      moreQueued: pending.more,
      processing: processing.size,
      batches: batches.length,
      uncertain: batches.some((b) => b.phase === "uncertain"),
      rebuilding: !!rebuild && !rebuild.done,
      error: state?.error ?? null,
      lastRunAt: state?.lastRunAt ?? null,
    };
  }
  async save(owner: string, input: z.infer<typeof categoriesInput>) {
    await this.requireConnection(owner);
    const parsed = categoriesInput.parse(input);
    const first = (await this.store.categorisation.config(owner)).version === 0;
    return this.store.categorisation.save(
      owner,
      parsed.categories,
      parsed.expectedVersion,
      parsed.recategorise || (first && !!parsed.categories.length),
    );
  }
  async recategorise(owner: string, expectedVersion: number) {
    const config = await this.store.categorisation.config(owner);
    return this.save(owner, { categories: config.categories, expectedVersion, recategorise: true });
  }
  async manual(
    owner: string,
    input: {
      accountId: string;
      transactionId: string;
      categoryId: string | null;
      expectedVersion: number;
    },
  ) {
    await this.requireConnection(owner);
    const config = await this.store.categorisation.config(owner);
    if (!config.version) throw new InputError("Create your categories first.");
    if (input.categoryId && !config.categories.some((c) => c.id === input.categoryId))
      throw new InputError("Choose an existing category.");
    const id = `${input.accountId}#${input.transactionId}`;
    // Only permit IDs belonging to transactions stored for this user.
    if (!(await this.store.transactions.identities(owner, [id])).has(id))
      throw new InputError("Transaction not found.");
    await this.store.categorisation.manual(
      owner,
      id,
      input.categoryId,
      input.expectedVersion,
      config,
    );
  }
  async list(owner: string, cursor?: string, range?: TransactionRange, limit = 50) {
    await this.requireConnection(owner);
    const page = await this.store.transactions.list(owner, cursor, limit, range);
    const ids = page.rows.map((row) => `${row.accountId}#${row.id}`);
    const [config, classifications, identities] = await Promise.all([
      this.store.categorisation.config(owner),
      this.store.categorisation.classifications(owner, ids),
      this.store.transactions.identities(owner, ids),
    ]);
    return {
      ...page,
      rows: page.rows.map((row) => {
        const result = classifications.get(`${row.accountId}#${row.id}`);
        const category = config.categories.find((c) => c.id === result?.categoryId);
        return {
          ...row,
          customCategory: category?.name ?? null,
          classification: result ? { ...result, categoryId: category?.id ?? null } : null,
          categorisationStatus: result?.failed
            ? "failed"
            : !result
              ? "pending"
              : result.source === "manual"
                ? "manual"
                : result.generation !== config.generation ||
                    result.digest !== identities.get(`${row.accountId}#${row.id}`)?.digest
                  ? "pending"
                  : "complete",
        };
      }),
    };
  }
  async insights(owner: string, range: TransactionRange, cursor?: string) {
    const page = await this.list(owner, cursor, range, 500);
    return { ...transactionInsights(page.rows), nextCursor: page.nextCursor };
  }
  async work(owner: string) {
    if (((await this.store.categorisation.workState(owner))?.retryAfter ?? 0) > Date.now()) return;
    const token = randomUUID();
    if (!(await this.store.categorisation.acquire(owner, token))) return;
    let errorMessage: string | null = null;
    let retryDelay = 1800000;
    try {
      const deadline = Date.now() + 85000;
      const connected = await this.connected(owner);
      const config = await this.store.categorisation.config(owner);
      if (!this.configured || !connected || !config.categories.length) {
        for (const batch of await this.store.categorisation.batches(owner)) {
          if (Date.now() > deadline - 25000) break;
          if (!batch.providerName && batch.phase === "uncertain") {
            const found = await this.provider.find(batch.displayName);
            if (!found) continue;
            batch.providerName = found;
            batch.phase = "submitted";
            await this.store.categorisation.saveBatch(owner, batch);
          }
          if (batch.providerName) {
            if (!(await this.provider.get(batch.providerName)).done) continue;
          } else if (batch.phase !== "prepared") continue;
          await this.store.categorisation.finish(owner, batch.id);
        }
        return;
      }
      let batches = await this.store.categorisation.batches(owner);
      for (const batch of batches) {
        if (Date.now() > deadline - 25000) break;
        if (!batch.providerName) {
          if (batch.phase === "prepared") {
            await this.submit(owner, batch, config.categories);
            continue;
          }
          const found = await this.provider.find(batch.displayName);
          if (!found) {
            retryDelay = 0;
            errorMessage =
              "A Gemini submission could not be confirmed. It will be checked again; it will not be submitted twice.";
            continue;
          }
          batch.providerName = found;
          batch.phase = "submitted";
          await this.store.categorisation.saveBatch(owner, batch);
        }
        const result = await this.provider.get(batch.providerName!);
        if (!result.done) continue;
        if (batch.version === config.version && batch.generation === config.generation) {
          let index = batch.nextIndex ?? 0;
          for (; index < batch.items.length; index++) {
            if (Date.now() > deadline - 10000) break;
            const item = batch.items[index]!;
            const categoryId = result.results.get(`tx_${index}`);
            if (
              !result.failed &&
              categoryId !== undefined &&
              (categoryId === null || config.categories.some((c) => c.id === categoryId))
            )
              await this.store.categorisation.apply(owner, batch, item, categoryId);
            else if (item.attempts >= 2)
              await this.store.categorisation.apply(owner, batch, item, null, true);
            else await this.store.categorisation.retry(owner, item);
          }
          if (index < batch.items.length) {
            batch.nextIndex = index;
            await this.store.categorisation.saveBatch(owner, batch);
            continue;
          }
        }
        await this.store.categorisation.finish(owner, batch.id);
      }
      // Existing histories and explicit rebuilds are queued in bounded pages.
      const rebuild = await this.store.categorisation.rebuild(owner);
      if (
        rebuild &&
        !rebuild.done &&
        rebuild.generation === config.generation &&
        Date.now() < deadline - 25000
      ) {
        const page = await this.store.transactions.list(owner, rebuild.cursor ?? undefined, 100);
        const ids = page.rows.map((r) => `${r.accountId}#${r.id}`);
        const [classifications, identities] = await Promise.all([
          this.store.categorisation.classifications(owner, ids),
          this.store.transactions.identities(owner, ids),
        ]);
        await this.store.categorisation.rebuildPage(
          owner,
          config.generation,
          page.rows
            .filter((row) => {
              const existing = classifications.get(`${row.accountId}#${row.id}`);
              return existing?.source !== "manual" && existing?.generation !== config.generation;
            })
            .map((row) => ({
              sk: `${row.accountId}#${row.id}`,
              rowKey: `${row.booking_date}#${row.accountId}#${row.id}`,
              digest: identities.get(`${row.accountId}#${row.id}`)?.digest ?? "",
              attempts: 0,
            })),
          page.nextCursor,
        );
      }
      batches = await this.store.categorisation.batches(owner);
      if (batches.length >= 3 || Date.now() > deadline - 25000) return;
      const inFlight = new Set(batches.flatMap((b) => b.items.map((i) => i.sk)));
      const pending = (await this.store.categorisation.pending(owner, 2000)).items
        .filter((i) => !inFlight.has(i.sk))
        .slice(0, 500);
      if (!pending.length) return;
      const [rows, classifications, identities] = await Promise.all([
        this.store.transactions.readRows(
          owner,
          pending.map((i) => i.rowKey),
        ),
        this.store.categorisation.classifications(
          owner,
          pending.map((i) => i.sk),
        ),
        this.store.transactions.identities(
          owner,
          pending.map((i) => i.sk),
        ),
      ]);
      const items = [];
      for (const item of pending) {
        const previous = classifications.get(item.sk);
        const row = rows.get(item.rowKey);
        if (
          previous?.source === "manual" ||
          !row ||
          identities.get(item.sk)?.digest !== item.digest
        ) {
          await this.store.categorisation.removePending(owner, item);
          continue;
        }
        items.push(item);
      }
      if (!items.length) return;
      const id = randomUUID();
      const batch: ClassificationBatch = {
        id,
        displayName: `wealth-${id}`,
        providerName: null,
        phase: "prepared",
        version: config.version,
        generation: config.generation,
        model: this.model,
        createdAt: new Date().toISOString(),
        items,
      };
      if (!(await this.store.categorisation.reserve(owner, batch))) return;
      await this.submit(owner, batch, config.categories, rows);
    } catch (error) {
      if (error instanceof GeminiError && error.uncertain) retryDelay = 0;
      errorMessage =
        error instanceof GeminiError
          ? error.message
          : "Categorisation could not finish. Saved categories are unchanged; the worker will retry.";
    } finally {
      await this.store.categorisation.release(owner, token, errorMessage, retryDelay);
    }
  }
  private async submit(
    owner: string,
    batch: ClassificationBatch,
    categories: z.infer<typeof categoriesInput>["categories"],
    suppliedRows?: Map<string, StoredEnduteTransaction>,
  ) {
    const current = await this.store.categorisation.config(owner);
    if (current.version !== batch.version || current.generation !== batch.generation) {
      await this.store.categorisation.finish(owner, batch.id);
      return;
    }
    const rows =
      suppliedRows ??
      (await this.store.transactions.readRows(
        owner,
        batch.items.map((i) => i.rowKey),
      ));
    const identities = await this.store.transactions.identities(
      owner,
      batch.items.map((i) => i.sk),
    );
    if (batch.items.some((i) => !rows.has(i.rowKey) || identities.get(i.sk)?.digest !== i.digest)) {
      await this.store.categorisation.finish(owner, batch.id);
      return;
    }
    batch.phase = "uncertain";
    await this.store.categorisation.saveBatch(owner, batch);
    try {
      batch.providerName = await this.provider.submit(
        batch.displayName,
        categories,
        batch.items.map((item, index) => ({ key: `tx_${index}`, row: rows.get(item.rowKey)! })),
      );
      batch.phase = "submitted";
      await this.store.categorisation.saveBatch(owner, batch);
    } catch (error) {
      if (error instanceof GeminiError && !error.uncertain)
        await this.store.categorisation.finish(owner, batch.id);
      throw error;
    }
  }
}
