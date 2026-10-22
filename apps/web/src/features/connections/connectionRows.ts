import {
  pence,
  accountKindLabels,
  hasManualBalance,
  type Snapshot,
  type Pence,
  type PublicConnection,
  type PublicBankConnection,
  type ManualAccount,
} from "@wealth/domain";

export interface ConnectionRow {
  id: string;
  name: string;
  detail?: string;
  provider: string;
  type: string;
  total: Pence | null;
  fetchedAt: string | null;
  trading?: PublicConnection;
  bankId?: string;
  manual?: ManualAccount;
}

export function tradingRows(connection: PublicConnection): ConnectionRow[] {
  const base = {
    provider: "Trading 212",
    type: connection.accountType === "isa" ? "Stocks ISA" : "Invest",
    fetchedAt: connection.valuation.fetchedAt,
    trading: connection,
  };
  if (connection.displayMode !== "holdings")
    return [
      { ...base, id: connection.id, name: connection.name, total: connection.valuation.total },
    ];
  const rows: ConnectionRow[] = [
    ...connection.valuation.positions.map((position) => ({
      ...base,
      id: `trading:${connection.id}:holding:${position.ticker}`,
      name: position.name,
      detail: `${connection.name} (${position.ticker})`,
      total: position.value,
    })),
    {
      ...base,
      id: `trading:${connection.id}:cash`,
      name: "Uninvested cash",
      detail: connection.name,
      total: connection.valuation.cash,
    },
  ];
  // Provider account totals can differ from the sum of separately fetched positions.
  const difference =
    connection.valuation.total - rows.reduce((sum, row) => sum + (row.total ?? 0), 0);
  if (difference)
    rows.push({
      ...base,
      id: `trading:${connection.id}:difference`,
      name: "Other account value",
      detail: connection.name,
      total: pence(difference),
    });
  return rows;
}

const providerLabel = (provider: "monzo" | "endute") =>
  provider === "endute" ? "Endute Connect" : "Monzo";

export function bankRows(
  connections: PublicBankConnection[],
  accounts: ManualAccount[],
): ConnectionRow[] {
  return connections.flatMap((connection) => {
    const provider = providerLabel(connection.provider);
    const tracked = accounts.filter(
      (account) =>
        !account.archived &&
        !hasManualBalance(account) &&
        account.automation?.connectionId === connection.id,
    );
    if (!tracked.length)
      return [
        {
          id: `${connection.provider}:${connection.id}`,
          name: provider,
          detail:
            connection.error ??
            (connection.status === "awaiting-approval"
              ? "Approve access in the Monzo app"
              : connection.status === "reconnect"
                ? "Reconnect to load balances"
                : "Choose accounts to track"),
          provider,
          type: "Connection",
          total: null,
          fetchedAt: null,
          bankId: connection.id,
        },
      ];
    return tracked.map((account) => ({
      id: account.id,
      name: account.name,
      ...(connection.error
        ? { detail: connection.error }
        : connection.status === "reconnect"
          ? { detail: "Reconnect to load balances" }
          : {}),
      provider,
      type: account.kind === "debt" ? "Debt" : "Cash",
      total: account.workingBalance ?? null,
      fetchedAt:
        connection.valuation?.balances.find(
          (balance) => balance.id === account.automation?.externalId,
        )?.fetchedAt ??
        connection.valuation?.fetchedAt ??
        null,
      bankId: connection.id,
    }));
  });
}

export function manualRows(
  accounts: (ManualAccount & { updatedAt?: string })[],
  snapshots: Pick<Snapshot, "month" | "updatedAt" | "balances">[],
  showArchived = false,
): ConnectionRow[] {
  const latest = [...snapshots].sort((a, b) => b.month.localeCompare(a.month));
  return accounts
    .filter(
      (account) =>
        (showArchived && account.archived) || (!account.archived && hasManualBalance(account)),
    )
    .map((account) => {
      const snapshot = latest.find((item) =>
        item.balances.some((balance) => balance.accountId === account.id),
      );
      const savedBalance = snapshot?.balances.find(
        (balance) => balance.accountId === account.id,
      )?.balance;
      return {
        id: account.id,
        name: account.name,
        ...(account.automation && !account.archived
          ? { detail: "Not synced. Enter its balance manually until it returns." }
          : {}),
        provider: account.automation ? providerLabel(account.automation.provider) : "Manual",
        type: accountKindLabels[account.kind],
        total: account.workingBalance ?? savedBalance ?? null,
        fetchedAt:
          account.workingBalance != null
            ? (account.updatedAt ?? null)
            : (snapshot?.updatedAt ?? account.updatedAt ?? null),
        manual: account,
      };
    });
}
