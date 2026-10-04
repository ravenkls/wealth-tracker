import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Alert, Box, IconButton, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import { Icon } from "../../components/Icon";
import { backgroundApi } from "../../lib/api";
import { errorMessage } from "../../lib/data";
import { monthRange } from "./ledgerModel";
import { TransactionList, type ManagedTransaction } from "./TransactionList";

export function TransactionsTab({
  selectedMonth,
  onMerchant,
}: {
  readonly selectedMonth: string;
  readonly onMerchant: (name: string) => void;
}) {
  const [pages, setPages] = useState({
    month: selectedMonth,
    cursors: [undefined] as (string | undefined)[],
    index: 0,
  });
  // Paging restarts whenever the month changes.
  if (pages.month !== selectedMonth)
    setPages({ month: selectedMonth, cursors: [undefined], index: 0 });
  const cursor = pages.cursors[pages.index];
  const transactions = useQuery({
    queryKey: ["endute-transactions", selectedMonth, cursor ?? "first"],
    queryFn: () =>
      backgroundApi.analysis.transactions.query({
        ...monthRange(selectedMonth),
        ...(cursor ? { cursor } : {}),
      }),
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });
  const next = transactions.isPlaceholderData ? null : transactions.data?.nextCursor;
  const rows = (transactions.data?.rows ?? []).map((row): ManagedTransaction => ({
    key: `${row.accountId}#${row.id}`,
    accountId: row.accountId,
    id: row.id,
    date: row.booking_date,
    amount: Number(row.amount) * 100,
    currency: row.currency,
    merchant: row.merchant,
    description: row.description,
    account: row.sandbox ? `${row.accountName} (sandbox)` : row.accountName,
    categoryId: row.classification?.categoryId ?? null,
    category: row.customCategory,
    version: row.classification?.version ?? 0,
    status: row.categorisationStatus,
    excluded: row.excluded,
  }));
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Transactions"
      sx={{ overflow: "hidden" }}
    >
      <Stack
        direction="row"
        useFlexGap
        sx={{ p: { xs: 2, sm: 2.5 }, pb: 1.5, gap: 1, alignItems: "center", flexWrap: "wrap" }}
      >
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography component="h2" sx={{ fontSize: 16, fontWeight: 600 }}>
            Transactions
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5 }}>
            Change a category, exclude a transfer or create a rule from any row. Excluded
            transactions are left out of every chart and total.
          </Typography>
        </Box>
        <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
          <IconButton
            size="small"
            aria-label="Previous page"
            disabled={!pages.index}
            onClick={() => setPages((value) => ({ ...value, index: value.index - 1 }))}
            sx={{ transform: "rotate(180deg)" }}
          >
            <Icon name="chevron" size={17} />
          </IconButton>
          <Typography component="output" sx={{ fontSize: 12, color: "text.secondary" }}>
            Page {pages.index + 1}
          </Typography>
          <IconButton
            size="small"
            aria-label="Next page"
            disabled={!next}
            onClick={() =>
              setPages((value) => ({
                ...value,
                cursors: [...value.cursors.slice(0, value.index + 1), next!],
                index: value.index + 1,
              }))
            }
          >
            <Icon name="chevron" size={17} />
          </IconButton>
        </Stack>
      </Stack>
      <LinearProgress
        aria-hidden
        sx={{ height: 2, visibility: transactions.isFetching ? "visible" : "hidden" }}
      />
      <Box
        sx={{ p: { xs: 2, sm: 2.5 }, pt: 2 }}
        aria-busy={transactions.isPending || transactions.isPlaceholderData}
      >
        {transactions.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorMessage(transactions.error)}
          </Alert>
        )}
        <TransactionList
          transactions={rows}
          onMerchant={onMerchant}
          showAccount
          empty={transactions.isPending ? "Loading transactions…" : "No transactions this month."}
        />
      </Box>
    </Paper>
  );
}
