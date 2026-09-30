import { randomUUID } from "node:crypto";
import type { BankConnection, ManualAccount, PublicBankConnection } from "@wealth/domain";
import type { CredentialCipher } from "../auth/encryption";
import { hash, token } from "../auth/tokens";
import {
  MonzoError,
  type MonzoClientCredentials,
  type MonzoProvider,
  type MonzoTokens,
} from "../integrations/monzo";
import type { WealthStore } from "../storage/records";
import { ConflictError, hasErrorName } from "../storage/errors";
import { InputError } from "./snapshot-service";

interface Credentials extends MonzoClientCredentials {
  tokens: MonzoTokens;
}
export function publicBankConnection(bank: BankConnection): PublicBankConnection {
  return {
    id: bank.id,
    provider: bank.provider,
    version: bank.version,
    status: bank.status,
    valuation: bank.valuation,
    error: bank.error,
  };
}

export class MonzoService {
  readonly redirectUri: string;
  constructor(
    private readonly store: WealthStore,
    private readonly provider: MonzoProvider,
    private readonly cipher: CredentialCipher,
    origin: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.redirectUri = `${origin}/auth/monzo/callback`;
  }
  private context(userId: string, id: string) {
    return `${userId}/monzo/${id}`;
  }

  async start(
    userId: string,
    sessionHash: string,
    input: MonzoClientCredentials & { connectionId?: string | undefined },
  ) {
    if (!sessionHash) throw new InputError("Sign in again before connecting Monzo.");
    if (input.connectionId) await this.connection(userId, input.connectionId);
    const state = token(),
      stateHash = hash(state);
    await this.store.monzoAttempts
      .create({
        stateHash,
        userId,
        sessionHash,
        ...(input.connectionId ? { connectionId: input.connectionId } : {}),
        encryptedCredentials: await this.cipher.encrypt(
          JSON.stringify({ clientId: input.clientId, clientSecret: input.clientSecret }),
          this.context(userId, stateHash),
        ),
        expiresAt: Math.floor(this.now().getTime() / 1000) + 600,
      })
      .go();
    return { url: this.provider.authorizeUrl(input.clientId, this.redirectUri, state) };
  }
  async complete(userId: string, sessionHash: string, state: string, code: string) {
    let attempt;
    try {
      attempt = (
        await this.store.monzoAttempts
          .delete({ stateHash: hash(state) })
          .where(
            (a, o) =>
              `${o.eq(a.userId, userId)} AND ${o.eq(a.sessionHash, sessionHash)} AND ${o.gt(a.expiresAt, Math.floor(this.now().getTime() / 1000))}`,
          )
          .go({ response: "all_old" })
      ).data;
    } catch (error) {
      if (hasErrorName(error, "ConditionalCheckFailedException"))
        throw new InputError("Monzo authorization expired. Connect again.");
      throw error;
    }
    if (!attempt) throw new InputError("Monzo authorization expired. Connect again.");
    const credentials = JSON.parse(
      await this.cipher.decrypt(attempt.encryptedCredentials, this.context(userId, hash(state))),
    ) as MonzoClientCredentials;
    const reserved = attempt.connectionId ? await this.lease(userId, attempt.connectionId) : null;
    let tokens: MonzoTokens;
    try {
      tokens = await this.provider.exchange(credentials, code, this.redirectUri);
    } catch (error) {
      if (reserved)
        await this.store.banks.save(
          userId,
          reserved.id,
          {
            ...reserved,
            version: reserved.version + 1,
            leaseUntil: 0,
            status: "reconnect",
            error: "Monzo authorization could not be completed. Reconnect.",
          },
          reserved.version,
        );
      throw error;
    }
    const id = `monzo-${hash(tokens.userId)}`;
    if (reserved && reserved.id !== id) {
      await this.store.banks.save(
        userId,
        reserved.id,
        { ...reserved, version: reserved.version + 1, leaseUntil: 0 },
        reserved.version,
      );
      try {
        await this.provider.revoke(tokens.accessToken);
      } catch {
        /* No credentials are retained for the mismatched user. */
      }
      throw new InputError("Reconnect the same Monzo user.");
    }
    const previous = await this.store.banks.get(userId, id);
    if (!reserved && previous && previous.data.leaseUntil > this.now().getTime())
      throw new InputError("A Monzo refresh is still running. Connect again when it finishes.");
    const bank: BankConnection = {
      id,
      provider: "monzo",
      version: (previous?.version ?? 0) + 1,
      disconnected: false,
      encryptedCredentials: await this.cipher.encrypt(
        JSON.stringify({ ...credentials, tokens }),
        this.context(userId, id),
      ),
      status: "awaiting-approval",
      valuation: previous?.data.valuation ?? null,
      error: null,
      leaseUntil: 0,
      refreshInFlight: false,
    };
    await this.store.banks.save(userId, id, bank, bank.version - 1);
    // Approval can arrive after the browser callback. The user retries from Accounts.
    return id;
  }
  private async connection(userId: string, id: string) {
    const record = await this.store.banks.get(userId, id);
    if (
      !record ||
      record.data.provider !== "monzo" ||
      record.data.disconnected ||
      !record.data.encryptedCredentials
    )
      throw new InputError("Monzo connection not found.");
    return record.data;
  }
  private async lease(userId: string, id: string, expectedVersion?: number) {
    const bank = await this.connection(userId, id);
    if (expectedVersion !== undefined && expectedVersion !== bank.version)
      throw new ConflictError();
    if (bank.leaseUntil > this.now().getTime())
      throw new InputError("Monzo is being refreshed. Wait a moment and retry.");
    const leased = { ...bank, version: bank.version + 1, leaseUntil: this.now().getTime() + 60000 };
    await this.store.banks.save(userId, id, leased, bank.version);
    return leased;
  }
  async refresh(userId: string, id: string) {
    let bank = await this.lease(userId, id);
    const save = async (patch: Partial<BankConnection>) => {
      const updated = { ...bank, ...patch, version: bank.version + 1 };
      await this.store.banks.save(userId, id, updated, bank.version);
      bank = updated;
    };
    try {
      if (bank.status === "reconnect" || bank.refreshInFlight)
        throw new MonzoError("Reconnect Monzo to renew access safely.", "unauthorized");
      const credentials = JSON.parse(
        await this.cipher.decrypt(bank.encryptedCredentials!, this.context(userId, id)),
      ) as Credentials;
      if (Date.parse(credentials.tokens.expiresAt) <= this.now().getTime() + 60000) {
        // Persist before calling the one-use grant. A crashed/ambiguous refresh must not replay it.
        await save({ refreshInFlight: true });
        const tokens = await this.provider.refresh(credentials, credentials.tokens.refreshToken);
        if (tokens.userId !== credentials.tokens.userId)
          throw new MonzoError("Monzo account identity changed. Reconnect.", "unauthorized");
        credentials.tokens = tokens;
        await save({
          encryptedCredentials: await this.cipher.encrypt(
            JSON.stringify(credentials),
            this.context(userId, id),
          ),
          refreshInFlight: false,
        });
      }
      const valuation = await this.provider.value(credentials.tokens.accessToken);
      const accounts = (await this.store.accounts.list(userId)).filter(
        (record) => record.data.automation?.connectionId === id && !record.data.archived,
      );
      let archived = 0;
      const updatedAccounts = accounts.map((record) => {
        const value = valuation.balances.find(
          (balance) => balance.id === record.data.automation!.externalId,
        );
        if (!value) archived++;
        return {
          expectedVersion: record.version,
          data: {
            ...record.data,
            version: record.version + 1,
            archived: !value,
            ...(value
              ? { name: value.name, kind: value.kind ?? "cash", workingBalance: value.balance }
              : {}),
          },
        };
      });
      const updated = {
        ...bank,
        version: bank.version + 1,
        valuation,
        status: "ready" as const,
        leaseUntil: 0,
        error: archived
          ? `${archived} missing Monzo ${archived === 1 ? "account or pot was" : "accounts or pots were"} archived. Saved history is unchanged.`
          : null,
      };
      await this.store.saveBankAccounts(userId, updated, bank.version, updatedAccounts);
      bank = updated;
      return publicBankConnection(bank);
    } catch (error) {
      const reconnect =
        bank.refreshInFlight || (error instanceof MonzoError && error.kind === "unauthorized");
      await save({
        leaseUntil: 0,
        status: reconnect ? "reconnect" : bank.status,
        error:
          error instanceof MonzoError || error instanceof InputError
            ? error.message
            : "Monzo refresh could not be saved. Retry.",
      });
      throw error;
    }
  }
  async select(userId: string, id: string, externalIds: string[], expectedVersion: number) {
    if (new Set(externalIds).size !== externalIds.length || externalIds.length > 80)
      throw new InputError("Choose each account or pot once, up to 80 balances.");
    const bank = await this.connection(userId, id);
    if (bank.version !== expectedVersion) throw new ConflictError();
    if (bank.leaseUntil > this.now().getTime())
      throw new InputError("Wait for the Monzo refresh to finish.");
    if (bank.status !== "ready" || !bank.valuation)
      throw new InputError("Approve Monzo access and refresh balances first.");
    const allAccounts = await this.store.accounts.list(userId);
    const existing = allAccounts.filter((record) => record.data.automation?.connectionId === id);
    if (
      new Set([...existing.map((record) => record.data.automation!.externalId), ...externalIds])
        .size > 80
    )
      throw new InputError("This connection supports up to 80 distinct tracked accounts and pots.");
    const updates: { data: ManualAccount; expectedVersion: number }[] = [];
    for (const externalId of externalIds) {
      const value = bank.valuation.balances.find((balance) => balance.id === externalId);
      if (!value) throw new InputError("Account list changed. Refresh Monzo and choose again.");
      const old = existing.find((record) => record.data.automation?.externalId === externalId);
      updates.push({
        expectedVersion: old?.version ?? 0,
        data: {
          id: old?.id ?? randomUUID(),
          name: value.name,
          kind: value.kind ?? "cash",
          archived: false,
          workingBalance: value.balance,
          version: (old?.version ?? 0) + 1,
          automation: { provider: "monzo", connectionId: id, externalId },
        },
      });
    }
    for (const record of existing.filter(
      (record) =>
        !record.data.archived && !externalIds.includes(record.data.automation!.externalId),
    ))
      updates.push({
        expectedVersion: record.version,
        data: { ...record.data, archived: true, version: record.version + 1 },
      });
    const count =
      allAccounts.filter(
        (record) => !record.data.archived && record.data.automation?.connectionId !== id,
      ).length + externalIds.length;
    if (count > 200) throw new InputError("Up to 200 active accounts can be recorded.");
    await this.store.saveBankAccounts(
      userId,
      { ...bank, version: bank.version + 1 },
      bank.version,
      updates,
    );
  }
  async disconnect(userId: string, id: string, expectedVersion: number) {
    const bank = await this.lease(userId, id, expectedVersion);
    try {
      const credentials = JSON.parse(
        await this.cipher.decrypt(bank.encryptedCredentials!, this.context(userId, id)),
      ) as Credentials;
      try {
        await this.provider.revoke(credentials.tokens.accessToken);
      } catch (error) {
        if (!(error instanceof MonzoError && error.kind === "unauthorized")) throw error;
      }
    } catch {
      // Local disconnection still removes secrets if Monzo cannot be reached.
    }
    const accounts = (await this.store.accounts.list(userId))
      .filter((record) => record.data.automation?.connectionId === id)
      .map((record) => {
        const { automation: _automation, ...manual } = record.data;
        return {
          expectedVersion: record.version,
          data: { ...manual, version: record.version + 1 },
        };
      });
    await this.store.saveBankAccounts(
      userId,
      {
        ...bank,
        version: bank.version + 1,
        disconnected: true,
        encryptedCredentials: null,
        leaseUntil: 0,
        refreshInFlight: false,
      },
      bank.version,
      accounts,
    );
  }
  async snapshotBalances(userId: string, accounts: ManualAccount[]) {
    const ids = [
      ...new Set(
        accounts.flatMap((account) =>
          account.automation ? [account.automation.connectionId] : [],
        ),
      ),
    ];
    const banks = await Promise.all(ids.map((id) => this.refresh(userId, id)));
    return accounts
      .filter((account) => account.automation)
      .flatMap((account) => {
        const bank = banks.find((bank) => bank.id === account.automation!.connectionId)!;
        const value = bank.valuation?.balances.find(
          (value) => value.id === account.automation!.externalId,
        );
        if (!value) return [];
        return [
          {
            accountId: account.id,
            name: value.name,
            kind: value.kind ?? "cash",
            balance: value.balance,
            automation: { ...account.automation!, fetchedAt: bank.valuation!.fetchedAt },
          },
        ];
      });
  }
}
