import type { InlineCorrectionInput } from "./schemas";
import { calculateNetWorth, calculateRecordedNetWorth, month } from "@wealth/domain";
import type { Snapshot, SavedInvestment } from "@wealth/domain";
import type { WealthStore } from "../storage/records";
import type { InvestmentProvider, TradingCredentials } from "../integrations/trading212";
import type { CredentialCipher } from "../auth/encryption";
import { hash } from "../auth/tokens";
import { ConflictError } from "../storage/errors";
import type { CurrentSnapshotInput, HistoricalSnapshotInput, CorrectionInput } from "./schemas";

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const operationDigest = (kind: string, value: unknown) =>
  hash(`${kind}:${canonical(value)}`);
export function currentMonth(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return month(
    `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`,
  );
}

export class SnapshotService {
  constructor(
    private readonly store: WealthStore,
    private readonly provider: InvestmentProvider,
    private readonly cipher: CredentialCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private async existing(
    userId: string,
    input: { month: string; expectedVersion: number; replaceConfirmed: boolean },
  ) {
    const existing = await this.store.snapshots.get(userId, input.month);
    if ((existing?.version ?? 0) !== input.expectedVersion) throw new ConflictError();
    if (existing && !input.replaceConfirmed)
      throw new InputError("Confirm replacing this month before saving.");
    return existing?.data ?? null;
  }
  private async commit(
    userId: string,
    snapshot: Snapshot,
    input: { expectedVersion: number; operationId: string },
    digest: string,
  ) {
    if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 250000)
      throw new InputError(
        "This snapshot contains too much detail to save. Reduce the number of accounts or contact support.",
      );
    return this.store.saveSnapshot(
      userId,
      snapshot,
      input.expectedVersion,
      input.operationId,
      digest,
    );
  }
  async record(userId: string, input: CurrentSnapshotInput) {
    const digest = operationDigest("current", input);
    const replay = await this.store.receipt(userId, input.operationId, digest);
    if (replay) return replay;
    const now = this.now();
    if (input.month !== currentMonth(now))
      throw new InputError(
        "Live investment values can only be recorded for the current month. Use Add past month for history.",
      );
    const existing = await this.existing(userId, input);
    const accounts = (await this.store.accounts.list(userId))
      .map((record) => record.data)
      .filter((account) => !account.archived);
    if (
      new Set(input.balances.map((row) => row.accountId)).size !== input.balances.length ||
      input.balances.length !== accounts.length
    )
      throw new InputError("Account list changed. Reload before recording.");
    const balances = accounts.map((account) => {
      const row = input.balances.find((balance) => balance.accountId === account.id);
      if (!row) throw new InputError("Enter a balance for every active account.");
      return {
        accountId: account.id,
        name: account.name,
        kind: account.kind,
        balance: row.balance,
      };
    });
    const connections = (await this.store.connections.list(userId))
      .map((record) => record.data)
      .filter((connection) => !connection.disconnected);
    const investments: SavedInvestment[] = await Promise.all(
      connections.map(async (connection) => {
        const credentials = JSON.parse(
          await this.cipher.decrypt(connection.encryptedCredentials!, `${userId}/${connection.id}`),
        ) as TradingCredentials;
        const value = await this.provider.value(credentials);
        if (value.providerId !== connection.id)
          throw new InputError(
            "Trading 212 account identity changed. Reconnect it before recording.",
          );
        return {
          connectionId: connection.id,
          name: connection.name,
          accountType: connection.accountType,
          ...value,
          positions: [...value.positions],
        };
      }),
    );
    const captured = this.now();
    if (input.month !== currentMonth(captured))
      throw new InputError(
        "The calendar month changed while fetching values. Reload and record the new month.",
      );
    const capturedAt = captured.toISOString();
    const totals = calculateRecordedNetWorth(balances, investments);
    const snapshot: Snapshot = {
      month: input.month,
      version: input.expectedVersion + 1,
      source: "current",
      capturedAt,
      createdAt: existing?.createdAt ?? capturedAt,
      updatedAt: capturedAt,
      balances,
      investments,
      cash: totals.cash,
      investmentTotal: totals.investments,
      pensions: totals.pensions,
      total: totals.total,
      notes: input.notes,
      periodIncome: input.periodIncome,
      cashPensionContributions: input.cashPensionContributions,
    };
    return this.commit(userId, snapshot, input, digest);
  }
  async historical(userId: string, input: HistoricalSnapshotInput) {
    const digest = operationDigest("historical", input);
    const replay = await this.store.receipt(userId, input.operationId, digest);
    if (replay) return replay;
    if (input.month >= currentMonth(this.now()))
      throw new InputError("Choose a past month for manual historical entry.");
    const existing = await this.existing(userId, input);
    const timestamp = this.now().toISOString();
    const totals = calculateNetWorth({
      cash: [input.cash],
      investments: [input.investments],
      pensions: [input.pensions],
    });
    const snapshot: Snapshot = {
      month: input.month,
      version: input.expectedVersion + 1,
      source: "historical",
      capturedAt: null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      balances: [],
      investments: [],
      cash: input.cash,
      investmentTotal: input.investments,
      pensions: input.pensions,
      total: totals.total,
      notes: input.notes,
      periodIncome: null,
      cashPensionContributions: null,
    };
    return this.commit(userId, snapshot, input, digest);
  }
  async inlineCorrect(userId: string, input: InlineCorrectionInput) {
    const digest = operationDigest("inline-correction", input);
    const replay = await this.store.receipt(userId, input.operationId, digest);
    if (replay) return replay;
    const record = await this.store.snapshots.get(userId, input.month);
    if (!record || record.version !== input.expectedVersion) throw new ConflictError();
    const snapshot = structuredClone(record.data);
    const change = input.change;
    if (change.field === "balance") {
      const balance = snapshot.balances.find((row) => row.accountId === change.accountId);
      if (snapshot.source !== "current" || !balance)
        throw new InputError("Choose a recorded manual account.");
      balance.balance = change.value;
    } else if (
      change.field === "cash" ||
      change.field === "investmentTotal" ||
      change.field === "pensions"
    ) {
      if (snapshot.source !== "historical")
        throw new InputError(
          "Correct individual manual balances. Recorded automated investment valuations are read-only.",
        );
      snapshot[change.field] = change.value;
    } else if (change.field === "notes") {
      snapshot.notes = change.value;
    } else {
      if (snapshot.source !== "current")
        throw new InputError("Historical totals have no captured income interval.");
      snapshot[change.field] = change.value;
    }
    const totals =
      snapshot.source === "current"
        ? calculateRecordedNetWorth(snapshot.balances, snapshot.investments)
        : calculateNetWorth({
            cash: [snapshot.cash],
            pensions: [snapshot.pensions],
            investments: [snapshot.investmentTotal],
          });
    return this.commit(
      userId,
      {
        ...snapshot,
        cash: totals.cash,
        investmentTotal: totals.investments,
        pensions: totals.pensions,
        total: totals.total,
        version: snapshot.version + 1,
        updatedAt: this.now().toISOString(),
      },
      input,
      digest,
    );
  }
  async correct(userId: string, input: CorrectionInput) {
    const digest = operationDigest("correction", input);
    const replay = await this.store.receipt(userId, input.operationId, digest);
    if (replay) return replay;
    const existing = await this.existing(userId, input);
    if (!existing || existing.source !== "current")
      throw new InputError("Use historical totals to edit this record.");
    if (
      input.balances.length !== existing.balances.length ||
      new Set(input.balances.map((row) => row.accountId)).size !== input.balances.length
    )
      throw new InputError("Correction must include the recorded accounts.");
    const balances = existing.balances.map((row) => {
      const updated = input.balances.find((item) => item.accountId === row.accountId);
      if (!updated) throw new InputError("Correction must include the recorded accounts.");
      return { ...row, balance: updated.balance };
    });
    const totals = calculateRecordedNetWorth(balances, existing.investments);
    return this.commit(
      userId,
      {
        ...existing,
        version: existing.version + 1,
        updatedAt: this.now().toISOString(),
        balances,
        cash: totals.cash,
        investmentTotal: totals.investments,
        pensions: totals.pensions,
        total: totals.total,
        notes: input.notes,
        periodIncome: input.periodIncome,
        cashPensionContributions: input.cashPensionContributions,
      },
      input,
      digest,
    );
  }
}
