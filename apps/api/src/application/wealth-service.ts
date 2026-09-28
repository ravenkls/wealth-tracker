import {
  calculateBudget,
  readingAt,
  savingsConnectionIds,
  isCashAccount,
  inferSavings,
  projectSavings,
  normalizeBudgetCategories,
} from "@wealth/domain";
import type {
  ManualAccountKind,
  TablePreferences,
  Pence,
  BudgetPlan,
  CashEvent,
  ManualAccount,
  Snapshot,
} from "@wealth/domain";
import type { WealthStore } from "../storage/records";
import { publicConnection } from "./connection-service";
import { InputError, currentMonth } from "./snapshot-service";
export class WealthService {
  constructor(readonly store: WealthStore) {}
  async saveAccount(
    userId: string,
    input: {
      id: string;
      name: string;
      kind: ManualAccountKind;
      archived: boolean;
      workingBalance?: Pence | null | undefined;
      expectedVersion: number;
    },
  ) {
    const existing = await this.store.accounts.get(userId, input.id);
    if (
      existing &&
      existing.data.kind !== input.kind &&
      !(isCashAccount(existing.data.kind) && isCashAccount(input.kind))
    )
      throw new InputError(
        "Only Cash and Debt can be switched after creation. Archive this account and create a new one to change its asset type.",
      );
    const data: ManualAccount = {
      id: input.id,
      name: input.name,
      kind: input.kind,
      archived: input.archived,
      workingBalance:
        input.workingBalance === undefined
          ? (existing?.data.workingBalance ?? null)
          : input.workingBalance,
      version: input.expectedVersion + 1,
    };
    await this.store.accounts.save(userId, input.id, data, input.expectedVersion);
    return data;
  }
  async appearance(userId: string) {
    const record = await this.store.appearance.get(userId, "theme");
    return { mode: record?.data.mode ?? "dark", version: record?.version ?? 0 };
  }
  async saveAppearance(userId: string, mode: "dark" | "light", expectedVersion: number) {
    const record = await this.store.appearance.save(userId, "theme", { mode }, expectedVersion);
    return { mode: record.data.mode, version: record.version };
  }
  async savePreferences(
    userId: string,
    id: string,
    preferences: TablePreferences,
    expectedVersion: number,
  ) {
    return this.store.preferences.save(userId, id, preferences, expectedVersion);
  }
  async saveBudget(userId: string, plan: BudgetPlan, expectedVersion: number) {
    const activeAccounts = (await this.store.accounts.list(userId)).filter(
      (record) => !record.data.archived,
    );
    const accountIds = new Set(
      activeAccounts.filter((record) => isCashAccount(record.data.kind)).map((record) => record.id),
    );
    const investmentIds = new Set(
      activeAccounts
        .filter((record) => record.data.kind === "investment")
        .map((record) => record.id),
    );
    const connectionIds = new Set(
      (await this.store.connections.list(userId))
        .filter((record) => !record.data.disconnected)
        .map((record) => record.id),
    );
    for (const line of [...plan.expenses, ...plan.savingsAllocations])
      if (line.destinationId && !accountIds.has(line.destinationId))
        throw new InputError("Choose an active cash or debt account for each budget destination.");
    if (plan.cashDestinationId && !accountIds.has(plan.cashDestinationId))
      throw new InputError("Choose an active cash or debt destination.");
    if (
      plan.investmentDestinationId &&
      !connectionIds.has(plan.investmentDestinationId) &&
      !investmentIds.has(plan.investmentDestinationId) &&
      !accountIds.has(plan.investmentDestinationId)
    )
      throw new InputError("Choose an active investment funding destination.");
    if (
      new Set([...plan.expenses, ...plan.savingsAllocations].map((line) => line.id)).size !==
      plan.expenses.length + plan.savingsAllocations.length
    )
      throw new InputError("Budget item IDs must be unique.");
    return this.store.budgets.save(
      userId,
      "current",
      normalizeBudgetCategories(plan),
      expectedVersion,
    );
  }
  async revisions(userId: string, period: string) {
    return (await this.store.revisions.list(`${userId}/${period}`))
      .map((record) => record.data)
      .sort((a, b) => b.version - a.version);
  }
  async bootstrap(userId: string) {
    const [accounts, connections, snapshots, budget, preferences] = await Promise.all([
      this.store.accounts.list(userId),
      this.store.connections.list(userId),
      this.store.snapshots.list(userId),
      this.store.budgets.get(userId, "current"),
      this.store.preferences.list(userId),
    ]);
    const history = snapshots
      .map((record) => record.data)
      .sort((a, b) => a.month.localeCompare(b.month));
    const latest = history.at(-1) ?? null;
    const metrics: { month: Snapshot["month"]; result: ReturnType<typeof inferSavings> }[] = [];
    const eventsByConnection = new Map<string, CashEvent[]>();
    for (const connection of connections)
      eventsByConnection.set(
        connection.id,
        (await this.store.events.list(`${userId}/${connection.id}`)).map((record) => record.data),
      );
    for (let index = 0; index < history.length; index++) {
      const snapshot = history[index]!;
      const previous = history[index - 1] ?? null;
      const capturedAt = readingAt(snapshot);
      const connectionIds = savingsConnectionIds(snapshot);
      const complete = connectionIds.every((connectionId) => {
        const connection = connections.find((record) => record.id === connectionId)?.data;
        return !!(
          capturedAt &&
          connection?.history.completedAt &&
          connection.history.startedAt >= capturedAt
        );
      });
      const events = connectionIds.flatMap(
        (connectionId) => eventsByConnection.get(connectionId) ?? [],
      );
      metrics.push({
        month: snapshot.month,
        result: inferSavings(previous, snapshot, events, complete),
      });
    }
    return {
      preferences: preferences.map(({ id, version, data }) => ({ id, version, preferences: data })),
      accounts: accounts.map((record) => record.data),
      connections: connections
        .filter((record) => !record.data.disconnected)
        .map((record) => publicConnection(record.data)),
      snapshots: history,
      budget: budget ? { version: budget.version, plan: budget.data } : null,
      budgetSummary: budget ? calculateBudget(budget.data, latest) : null,
      metrics,
      projections: projectSavings(budget?.data ?? null, history, metrics, currentMonth(new Date())),
    };
  }
}
