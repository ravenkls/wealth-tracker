import type {
  Connection,
  HistoryProgress,
  PublicConnection,
  SavedInvestment,
} from "@wealth/domain";
import type { WealthStore } from "../storage/records";
import type { CredentialCipher } from "../auth/encryption";
import type { InvestmentProvider, TradingCredentials } from "../integrations/trading212";
import { Trading212Error } from "../integrations/trading212";
import { InputError } from "./snapshot-service";
import { hash } from "../auth/tokens";

export function publicConnection(connection: Connection): PublicConnection {
  const { encryptedCredentials: _credentials, ...safe } = connection;
  return safe;
}
export function freshHistory(now: Date): HistoryProgress {
  return {
    transactionsNext: null,
    dividendsNext: null,
    transactionsDone: false,
    dividendsDone: false,
    startedAt: now.toISOString(),
    completedAt: null,
    retryAt: null,
    error: null,
  };
}
export class ConnectionService {
  constructor(
    private readonly store: WealthStore,
    private readonly provider: InvestmentProvider,
    private readonly cipher: CredentialCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async connect(
    userId: string,
    input: { name: string; accountType: "invest" | "isa"; apiKey: string; apiSecret: string },
  ) {
    const credentials = { apiKey: input.apiKey, apiSecret: input.apiSecret };
    const value = await this.provider.value(credentials);
    const existing = await this.store.connections.get(userId, value.providerId);
    if (existing && !existing.data.disconnected)
      throw new InputError("This Trading 212 account is already connected.");
    const version = (existing?.version ?? 0) + 1;
    const valuation: SavedInvestment = {
      connectionId: value.providerId,
      name: input.name,
      accountType: input.accountType,
      total: value.total,
      cash: value.cash,
      fetchedAt: value.fetchedAt,
      positions: [...value.positions],
    };
    const connection: Connection = {
      id: value.providerId,
      name: input.name,
      accountType: input.accountType,
      version,
      disconnected: false,
      encryptedCredentials: await this.cipher.encrypt(
        JSON.stringify(credentials),
        `${userId}/${value.providerId}`,
      ),
      valuation,
      history: freshHistory(this.now()),
    };
    await this.store.connections.save(userId, connection.id, connection, version - 1);
    return publicConnection(connection);
  }
  async disconnect(userId: string, id: string, version: number) {
    const existing = await this.store.connections.get(userId, id);
    if (!existing) throw new InputError("Connection not found.");
    await this.store.connections.save(
      userId,
      id,
      { ...existing.data, version: version + 1, disconnected: true, encryptedCredentials: null },
      version,
    );
  }
  async restartHistory(userId: string, id: string) {
    const existing = await this.store.connections.get(userId, id);
    if (!existing || existing.data.disconnected) throw new InputError("Connection not found.");
    const data = {
      ...existing.data,
      version: existing.version + 1,
      history: freshHistory(this.now()),
    };
    await this.store.connections.save(userId, id, data, existing.version);
    return publicConnection(data);
  }
  async refreshValue(userId: string, id: string) {
    const existing = await this.store.connections.get(userId, id);
    if (!existing || !existing.data.encryptedCredentials || existing.data.disconnected)
      throw new InputError("Connection not found.");
    const value = await this.provider.value(await this.credentials(userId, existing.data));
    if (value.providerId !== id)
      throw new InputError("Provider account identity changed. Reconnect this account.");
    const data = {
      ...existing.data,
      version: existing.version + 1,
      valuation: {
        ...existing.data.valuation,
        total: value.total,
        cash: value.cash,
        fetchedAt: value.fetchedAt,
        positions: [...value.positions],
      },
    };
    await this.store.connections.save(userId, id, data, existing.version);
    return publicConnection(data);
  }
  private async credentials(userId: string, connection: Connection) {
    if (!connection.encryptedCredentials) throw new InputError("Connection has been disconnected.");
    return JSON.parse(
      await this.cipher.decrypt(connection.encryptedCredentials, `${userId}/${connection.id}`),
    ) as TradingCredentials;
  }
  async advanceHistory(userId: string, id: string) {
    const record = await this.store.connections.get(userId, id);
    if (!record || record.data.disconnected) throw new InputError("Connection not found.");
    const connection = record.data;
    const now = this.now();
    if (
      connection.history.completedAt ||
      (connection.history.retryAt && new Date(connection.history.retryAt) > now)
    )
      return publicConnection(connection);
    const leased = {
      ...connection,
      version: record.version + 1,
      history: {
        ...connection.history,
        error: null,
        retryAt: new Date(now.getTime() + 60000).toISOString(),
      },
    };
    await this.store.connections.save(userId, id, leased, record.version);
    const progress: HistoryProgress = { ...leased.history };
    try {
      const credentials = await this.credentials(userId, connection);
      for (const source of ["transactions", "dividends"] as const) {
        const done = source === "transactions" ? "transactionsDone" : "dividendsDone";
        const next = source === "transactions" ? "transactionsNext" : "dividendsNext";
        if (progress[done]) continue;
        const page = await this.provider[source](credentials, progress[next] ?? undefined);
        for (const event of page.events) {
          await this.store.events.upsertImported(
            `${userId}/${id}`,
            hash(`${event.source}:${event.reference}`),
            event,
            now,
          );
        }
        progress[next] = page.nextPage;
        progress[done] = page.nextPage === null;
      }
      progress.retryAt = new Date(this.now().getTime() + 10500).toISOString();
      if (progress.transactionsDone && progress.dividendsDone) {
        progress.completedAt = this.now().toISOString();
        progress.retryAt = null;
      }
    } catch (error) {
      progress.error =
        error instanceof Trading212Error
          ? error.message
          : "History could not be refreshed. Retry when the connection is available.";
      progress.retryAt =
        error instanceof Trading212Error && error.retryAfterSeconds
          ? new Date(this.now().getTime() + error.retryAfterSeconds * 1000).toISOString()
          : null;
    }
    const updated = { ...leased, version: leased.version + 1, history: progress };
    await this.store.connections.save(userId, id, updated, leased.version);
    return publicConnection(updated);
  }
}
