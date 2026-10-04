import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Chip,
  Divider,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import { Icon } from "../../components/Icon";
import { chartMoney } from "../../components/charts/ChartFrame";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/data";
import { useCategories } from "./CategoriesPanel";
import { CategoryPill } from "./CategoryPill";
import { formatDate } from "./highlights";
import type { LedgerEntry, LedgerPage } from "./ledgerModel";
import { MerchantLink, Muted } from "./parts";
import { RuleDialog, type RuleTarget } from "./rules";

export interface ManagedTransaction {
  key: string;
  accountId: string;
  id: string;
  date: string;
  // Signed hundredths of the currency unit.
  amount: number;
  currency: string;
  merchant: string;
  description: string;
  account: string | null;
  categoryId: string | null;
  category: string | null;
  version: number;
  status: string;
  excluded: boolean;
}
export const fromLedger = (entry: LedgerEntry): ManagedTransaction => ({
  ...entry,
  excluded: false,
});

// Patch every cached ledger window at once so analysis updates before the refetch lands.
function patchLedger(
  client: ReturnType<typeof useQueryClient>,
  key: string,
  update: (entry: LedgerEntry) => LedgerEntry | null,
) {
  client.setQueriesData<InfiniteData<LedgerPage>>(
    { queryKey: ["transaction-ledger"] },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          entries: page.entries.flatMap((entry) =>
            entry.key === key ? (update(entry) ?? []) : [entry],
          ),
        })),
      },
  );
}

export function TransactionList({
  transactions,
  limit,
  onMerchant,
  aside,
  showAccount = false,
  showYear = false,
  empty = "No transactions.",
}: {
  readonly transactions: readonly ManagedTransaction[];
  readonly limit?: number;
  readonly onMerchant?: (name: string) => void;
  readonly aside?: (transaction: ManagedTransaction) => ReactNode;
  readonly showAccount?: boolean;
  readonly showYear?: boolean;
  readonly empty?: string;
}) {
  const client = useQueryClient();
  const categories = useCategories();
  const [menu, setMenu] = useState<{ anchor: HTMLElement; row: ManagedTransaction } | null>(null);
  const [rule, setRule] = useState<RuleTarget | null>(null);
  const refresh = () =>
    Promise.all(
      ["endute-transactions", "transaction-ledger", "purchase-categories"].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  const exclude = useMutation({
    mutationFn: ({ row, excluded }: { row: ManagedTransaction; excluded: boolean }) =>
      api.analysis.exclude.mutate({ accountId: row.accountId, transactionId: row.id, excluded }),
    onSuccess: (_, { row, excluded }) => {
      if (excluded) patchLedger(client, row.key, () => null);
      return refresh();
    },
  });
  async function assign(row: ManagedTransaction, categoryId: string | null) {
    await api.categories.assign.mutate({
      accountId: row.accountId,
      transactionId: row.id,
      categoryId,
      expectedVersion: row.version,
    });
    const category = categories.data?.categories.find((item) => item.id === categoryId);
    patchLedger(client, row.key, (entry) => ({
      ...entry,
      categoryId,
      category: category?.name ?? null,
      version: entry.version + 1,
      status: "manual",
    }));
    await refresh();
  }
  if (!transactions.length) return <Muted>{empty}</Muted>;
  return (
    <>
      {exclude.isError && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {errorMessage(exclude.error)}
        </Alert>
      )}
      <Stack component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {transactions.slice(0, limit).map((row) => (
          <Stack
            component="li"
            key={row.key}
            direction="row"
            sx={{
              py: 1.25,
              gap: 1.5,
              alignItems: "center",
              borderTop: 1,
              borderColor: "divider",
              "&:first-of-type": { borderTop: 0, pt: 0 },
            }}
          >
            <Typography
              sx={{
                fontSize: 12,
                color: "text.secondary",
                width: showYear ? 76 : 48,
                flexShrink: 0,
              }}
            >
              {formatDate(row.date, showYear)}
            </Typography>
            <Box sx={{ minWidth: 0, flex: 1, opacity: row.excluded ? 0.55 : 1 }}>
              {onMerchant ? (
                <MerchantLink name={row.merchant} onClick={() => onMerchant(row.merchant)} />
              ) : (
                <Typography noWrap sx={{ fontSize: 13, fontWeight: 500 }}>
                  {row.merchant}
                </Typography>
              )}
              <Stack
                direction="row"
                useFlexGap
                sx={{ alignItems: "center", gap: 0.75, mt: 0.5, minWidth: 0, flexWrap: "wrap" }}
              >
                <CategoryPill
                  compact
                  id={row.categoryId}
                  name={row.category}
                  label={`Change category for ${row.description}`}
                  disabled={!categories.data?.version}
                  categories={categories.data?.categories ?? []}
                  onCommit={(categoryId) => assign(row, categoryId)}
                />
                {row.status === "rule" && (
                  <Typography sx={{ fontSize: 11, color: "text.secondary" }}>by rule</Typography>
                )}
                {row.excluded && <Chip size="small" variant="outlined" label="Excluded" />}
                <Typography
                  noWrap
                  color="text.secondary"
                  sx={{ fontSize: 11, minWidth: 0, flex: 1 }}
                  title={row.description}
                >
                  {row.description}
                  {showAccount && row.account ? ` · ${row.account}` : ""}
                </Typography>
              </Stack>
            </Box>
            {aside?.(row)}
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
                color: row.excluded
                  ? "text.disabled"
                  : row.amount > 0
                    ? "success.main"
                    : "text.primary",
                textDecoration: row.excluded ? "line-through" : "none",
              }}
            >
              {row.amount > 0 ? "+" : ""}
              {chartMoney(row.amount, row.currency)}
            </Typography>
            <IconButton
              size="small"
              aria-label={`More actions for ${row.description}`}
              aria-haspopup="menu"
              disabled={exclude.isPending && exclude.variables.row.key === row.key}
              onClick={(event) => setMenu({ anchor: event.currentTarget, row })}
              sx={{ mr: -0.75 }}
            >
              <Icon name="more" size={18} />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            exclude.mutate({ row: menu!.row, excluded: !menu!.row.excluded });
            setMenu(null);
          }}
        >
          <ListItemText
            primary={menu?.row.excluded ? "Include in analysis" : "Exclude from analysis"}
            secondary="Just this transaction"
          />
        </MenuItem>
        <Divider />
        <MenuItem
          disabled={menu?.row.merchant === "Unknown merchant"}
          onClick={() => {
            setRule({
              merchant: menu!.row.merchant,
              description: null,
              categoryId: menu!.row.categoryId,
            });
            setMenu(null);
          }}
        >
          Create rule for this merchant
        </MenuItem>
        <MenuItem
          onClick={() => {
            setRule({
              merchant: menu!.row.merchant,
              description: menu!.row.description,
              categoryId: menu!.row.categoryId,
            });
            setMenu(null);
          }}
        >
          Create rule for this merchant &amp; description
        </MenuItem>
        {onMerchant && (
          <MenuItem
            onClick={() => {
              onMerchant(menu!.row.merchant);
              setMenu(null);
            }}
          >
            View merchant
          </MenuItem>
        )}
      </Menu>
      <RuleDialog
        target={rule}
        categories={categories.data?.categories ?? []}
        onClose={() => setRule(null)}
      />
    </>
  );
}
