import { randomUUID } from "node:crypto";
import type { BankConnection, ManualAccount } from "@wealth/domain";
import type { CredentialCipher } from "../auth/encryption";
import { EnduteError, type EnduteProvider, type EnduteValuation } from "../integrations/endute";
import type { WealthStore } from "../storage/records";
import { ConflictError } from "../storage/errors";
import { InputError } from "./snapshot-service";
import { publicBankConnection } from "./monzo-service";

export class EnduteService {
  constructor(
    private readonly store: WealthStore,
    private readonly provider: EnduteProvider,
    private readonly cipher: CredentialCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private context(userId: string) {
    return `${userId}/endute/endute`;
  }

  async connect(userId: string, input: { apiKey: string; expectedVersion: number }) {
    const previous = await this.store.banks.get(userId, "endute");
    if ((previous && !previous.data.disconnected ? previous.version : 0) !== input.expectedVersion)
      throw new ConflictError();
    if (previous && previous.data.leaseUntil > this.now().getTime())
      throw new InputError("Wait for the Endute refresh to finish.");
    if (previous?.data.retryAt && Date.parse(previous.data.retryAt) > this.now().getTime())
      throw new InputError(`Wait until ${previous.data.retryAt} before retrying Endute.`);
    const value = await this.provider.value(input.apiKey);
    const tracked = (await this.store.accounts.list(userId)).filter(
      (record) => !record.data.archived && record.data.automation?.connectionId === "endute",
    );
    if (tracked.some((record) => !value.accountIds.includes(record.data.automation!.externalId)))
      throw new InputError(
        "This key does not expose all tracked Endute accounts. Enable them in the portal, or deselect them before changing the key.",
      );
    const bank: BankConnection = {
      id: "endute",
      provider: "endute",
      version: (previous?.version ?? 0) + 1,
      encryptedCredentials: await this.cipher.encrypt(
        JSON.stringify({ apiKey: input.apiKey }),
        this.context(userId),
      ),
      disconnected: false,
      status: "ready",
      valuation: null,
      error: null,
      leaseUntil: 0,
      refreshInFlight: false,
      retryAt: null,
    };
    return this.saveValue(userId, bank, value, bank.version - 1);
  }

  private async connection(userId: string, id: string) {
    const record = await this.store.banks.get(userId, id);
    if (
      !record ||
      record.data.provider !== "endute" ||
      record.data.disconnected ||
      !record.data.encryptedCredentials
    )
      throw new InputError("Endute connection not found.");
    return record.data;
  }

  private async saveValue(
    userId: string,
    bank: BankConnection,
    value: EnduteValuation,
    expectedVersion: number,
  ) {
    const accounts = (await this.store.accounts.list(userId)).filter(
      (record) => !record.data.archived && record.data.automation?.connectionId === bank.id,
    );
    const updates = accounts.map((record) => {
      const externalId = record.data.automation!.externalId;
      const balance = value.balances.find((balance) => balance.id === externalId);
      if (!balance && value.accountIds.includes(externalId))
        throw new EnduteError(
          `${record.data.name}: no supported GBP balance is available. Check Endute before refreshing or recording a snapshot.`,
        );
      return {
        expectedVersion: record.version,
        data: {
          ...record.data,
          version: record.version + 1,
          archived: !balance,
          ...(balance
            ? { name: balance.name, kind: balance.kind ?? "cash", workingBalance: balance.balance }
            : {}),
        },
      };
    });
    const archived = updates.filter((update) => update.data.archived).length;
    const warnings = [
      ...value.warnings,
      ...(archived
        ? [`${archived} missing Endute accounts were archived. Saved history is unchanged.`]
        : []),
    ];
    const updated: BankConnection = {
      ...bank,
      version: expectedVersion + 1,
      valuation: { balances: value.balances, fetchedAt: value.fetchedAt },
      status: "ready",
      leaseUntil: 0,
      retryAt: null,
      error: warnings.join(" ") || null,
    };
    await this.store.saveBankAccounts(userId, updated, expectedVersion, updates);
    return publicBankConnection(updated);
  }

  async refresh(userId: string, id: string) {
    const bank = await this.connection(userId, id);
    if (bank.leaseUntil > this.now().getTime())
      throw new InputError("Endute is being refreshed. Wait and retry.");
    if (bank.retryAt && Date.parse(bank.retryAt) > this.now().getTime())
      throw new InputError(`Wait until ${bank.retryAt} before retrying Endute.`);
    const leased = {
      ...bank,
      version: bank.version + 1,
      leaseUntil: this.now().getTime() + 300000,
    };
    await this.store.banks.save(userId, id, leased, bank.version);
    try {
      const credentials = JSON.parse(
        await this.cipher.decrypt(bank.encryptedCredentials!, this.context(userId)),
      ) as { apiKey: string };
      return await this.saveValue(
        userId,
        leased,
        await this.provider.value(credentials.apiKey),
        leased.version,
      );
    } catch (error) {
      await this.store.banks.save(
        userId,
        id,
        {
          ...leased,
          version: leased.version + 1,
          leaseUntil: 0,
          status:
            error instanceof EnduteError && error.code === "invalid_api_key"
              ? "reconnect"
              : bank.status,
          retryAt:
            error instanceof EnduteError && error.retryAfterSeconds
              ? new Date(this.now().getTime() + error.retryAfterSeconds * 1000).toISOString()
              : null,
          error:
            error instanceof EnduteError
              ? error.message
              : "Endute refresh could not be saved. Retry.",
        },
        leased.version,
      );
      throw error;
    }
  }
  async select(userId: string, id: string, externalIds: string[], expectedVersion: number) {
    if (new Set(externalIds).size !== externalIds.length || externalIds.length > 80)
      throw new InputError("Choose each account once, up to 80 balances.");
    const bank = await this.connection(userId, id);
    if (bank.version !== expectedVersion) throw new ConflictError();
    if (bank.leaseUntil > this.now().getTime())
      throw new InputError("Wait for the Endute refresh to finish.");
    if (bank.status !== "ready" || !bank.valuation)
      throw new InputError("Refresh Endute balances first.");
    const allAccounts = await this.store.accounts.list(userId);
    const existing = allAccounts.filter((record) => record.data.automation?.connectionId === id);
    if (
      new Set([...existing.map((record) => record.data.automation!.externalId), ...externalIds])
        .size > 80
    )
      throw new InputError("This connection supports up to 80 distinct tracked accounts.");
    const updates: { data: ManualAccount; expectedVersion: number }[] = [];
    for (const externalId of externalIds) {
      const value = bank.valuation.balances.find((balance) => balance.id === externalId);
      if (!value) throw new InputError("Account list changed. Refresh Endute and choose again.");
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
          automation: { provider: "endute", connectionId: id, externalId },
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
    const bank = await this.connection(userId, id);
    if (bank.version !== expectedVersion) throw new ConflictError();
    if (bank.leaseUntil > this.now().getTime())
      throw new InputError("Wait for the Endute refresh to finish.");
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
        retryAt: null,
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
            automation: {
              ...account.automation!,
              fetchedAt: value.fetchedAt ?? bank.valuation!.fetchedAt,
            },
          },
        ];
      });
  }
}
