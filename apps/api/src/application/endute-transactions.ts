import { randomUUID } from "node:crypto";
import type { CredentialCipher } from "../auth/encryption";
import { EnduteError, type EnduteTransactionProvider } from "../integrations/endute";
import type { WealthStore } from "../storage/records";
import type { TransactionSyncState } from "../storage/endute-transactions";
import { InputError } from "./snapshot-service";

export class EnduteTransactionsService {
  constructor(
    private readonly store: WealthStore,
    private readonly provider: EnduteTransactionProvider,
    private readonly cipher: CredentialCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private async connection(owner: string) {
    const bank = await this.store.banks.get(owner, "endute");
    if (
      !bank ||
      bank.data.disconnected ||
      !bank.data.encryptedCredentials ||
      bank.data.provider !== "endute"
    )
      throw new InputError("Connect Endute to use Analysis.");
    return bank;
  }
  private publicState(state: TransactionSyncState) {
    return {
      lastAttemptAt: state.lastAttemptAt,
      lastSyncedAt: state.lastSyncedAt,
      error: state.error,
      retryAt: state.retryAt,
      syncing: state.leaseUntil > this.now().getTime(),
      retrying: !!state.retryAt && Date.parse(state.retryAt) > this.now().getTime(),
      backfilling: Object.values(state.accounts).some((account) => !account.backfillDone),
      accounts: Object.keys(state.accounts).length,
    };
  }
  async status(owner: string) {
    await this.connection(owner);
    await this.store.transactions.register(owner);
    return this.publicState(await this.store.transactions.state(owner));
  }
  async list(
    owner: string,
    cursor?: string,
    range?: import("../storage/endute-transactions").TransactionRange,
  ) {
    await this.connection(owner);
    return this.store.transactions.list(owner, cursor, 50, range);
  }
  async exclude(
    owner: string,
    input: { accountId: string; transactionId: string; excluded: boolean },
  ) {
    await this.connection(owner);
    await this.store.transactions.exclude(
      owner,
      `${input.accountId}#${input.transactionId}`,
      input.excluded,
    );
  }
  async sync(owner: string, background = false) {
    let bank;
    try {
      bank = await this.connection(owner);
    } catch (error) {
      if (background && error instanceof InputError) {
        await this.store.transactions.unregister(owner);
        return null;
      }
      throw error;
    }
    await this.store.transactions.register(owner);
    const state = await this.store.transactions.acquire(owner, randomUUID(), this.now().getTime());
    if (!state) return this.status(owner);
    if (state.retryAt && Date.parse(state.retryAt) > this.now().getTime()) {
      await this.store.transactions.checkpoint(owner, state, true);
      return this.publicState({ ...state, leaseUntil: 0 });
    }
    const startedAt = this.now().toISOString();
    const deadline = Date.now() + (background ? 90000 : 18000);
    const signal = AbortSignal.timeout(background ? 90000 : 18000);
    state.lastAttemptAt = startedAt;
    state.error = null;
    state.retryAt = null;
    try {
      const { apiKey } = JSON.parse(
        await this.cipher.decrypt(bank.data.encryptedCredentials!, `${owner}/endute/endute`),
      ) as { apiKey: string };
      const accounts = await this.provider.accounts(apiKey, signal);
      if (
        accounts.length > 200 ||
        new Set(accounts.map((account) => account.id)).size !== accounts.length
      )
        throw new EnduteError("Endute returned an unsupported or duplicate account list.");
      const active = new Set(accounts.map((account) => account.id));
      for (const id of Object.keys(state.accounts)) if (!active.has(id)) delete state.accounts[id];
      for (const account of accounts)
        state.accounts[account.id] ??= {
          cycleStartedAt: null,
          next: null,
          from: null,
          lastCompletedAt: null,
          backfillDone: false,
        };
      const maxPages = background ? 80 : 10;
      let pages = 0;
      const finished = new Set<string>();
      // Round-robin keeps large histories from starving other accounts.
      while (
        accounts.length &&
        pages < maxPages &&
        Date.now() < deadline - 1500 &&
        finished.size < accounts.length
      ) {
        const account = accounts[state.accountIndex % accounts.length]!;
        state.accountIndex = (state.accountIndex + 1) % accounts.length;
        const progress = state.accounts[account.id]!;
        if (finished.has(account.id)) continue;
        if (!progress.next) {
          progress.cycleStartedAt = startedAt;
          progress.from =
            progress.backfillDone && progress.lastCompletedAt
              ? new Date(Date.parse(progress.lastCompletedAt) - 7 * 86400000)
                  .toISOString()
                  .slice(0, 10)
              : null;
        }
        const page = await this.provider.transactions(
          apiKey,
          account.id,
          progress.next ?? undefined,
          progress.from,
          signal,
        );
        if (page.next && page.next === progress.next)
          throw new EnduteError("Endute returned a repeated transaction cursor.");
        await this.store.transactions.putPage(
          owner,
          page.results.map((row) => ({
            ...row,
            accountId: account.id,
            accountName: account.name,
            institution: account.institution,
            importedAt: this.now().toISOString(),
          })),
          state.leaseToken!,
          {
            key: this.store.banks.entity.get({ owner, id: "endute" }).params().Key!,
            credentials: bank.data.encryptedCredentials!,
          },
        );
        progress.next = page.next;
        if (!page.next) {
          progress.backfillDone = true;
          progress.lastCompletedAt = progress.cycleStartedAt ?? startedAt;
          progress.from = null;
          finished.add(account.id);
        }
        pages++;
        state.lastSyncedAt = this.now().toISOString();
        await this.store.transactions.checkpoint(owner, state, false);
      }
      if (!accounts.length) state.lastSyncedAt = this.now().toISOString();
    } catch (error) {
      state.error =
        error instanceof EnduteError || error instanceof InputError
          ? error.message
          : "Transaction sync could not finish. Saved transactions are available; try again.";
      if (error instanceof EnduteError && error.retryAfterSeconds)
        state.retryAt = new Date(
          this.now().getTime() + error.retryAfterSeconds * 1000,
        ).toISOString();
    }
    await this.store.transactions.checkpoint(owner, state, true);
    return this.publicState({ ...state, leaseUntil: 0 });
  }
}
