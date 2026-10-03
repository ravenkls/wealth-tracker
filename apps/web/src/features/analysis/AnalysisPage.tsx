import { CategoriesPanel, useCategories } from "./CategoriesPanel";
import { CategoryPill } from "./CategoryPill";
import { AnalysisInsights } from "./AnalysisInsights";
import { BudgetTracking } from "./BudgetTracking";
import { monthlyBudgets } from "@wealth/domain";
import { monthRange } from "./insightsModel";
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Checkbox, Stack, Typography } from "@mui/material";
import { DataTable } from "../../components/table/DataTable";
import { Icon } from "../../components/Icon";
import { PageHeading } from "../../components/PageHeading";
import { api, backgroundApi } from "../../lib/api";
import { errorMessage, type AppData } from "../../lib/data";

export function AnalysisPage({ data }: { readonly data: AppData }) {
  const client = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState<string>(data.currentMonth);
  const range = monthRange(selectedMonth);
  const categories = useCategories();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex];
  const status = useQuery({
    queryKey: ["endute-sync"],
    queryFn: () => backgroundApi.analysis.status.query(),
    refetchInterval: 15000,
  });
  const transactions = useQuery({
    queryKey: ["endute-transactions", selectedMonth, cursor ?? "first"],
    queryFn: () =>
      backgroundApi.analysis.transactions.query({ ...range, ...(cursor ? { cursor } : {}) }),
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });
  const refresh = useMutation({
    mutationFn: () => api.analysis.refresh.mutate(),
    onSuccess: async () => {
      setCursors([undefined]);
      setPageIndex(0);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["endute-sync"] }),
        client.invalidateQueries({ queryKey: ["transaction-insights"] }),
        client.invalidateQueries({ queryKey: ["endute-transactions"] }),
      ]);
    },
  });
  const exclude = useMutation({
    mutationFn: (input: { accountId: string; transactionId: string; excluded: boolean }) =>
      api.analysis.exclude.mutate(input),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["endute-transactions"] }),
        client.invalidateQueries({ queryKey: ["transaction-insights"] }),
      ]),
  });
  const retryAt = status.data?.retryAt;
  const waiting = status.data?.retrying ?? false;
  const rows = (transactions.data?.rows ?? []).map((row) => ({
    ...row,
    customCategory: "customCategory" in row ? row.customCategory : null,
    classification: "classification" in row ? row.classification : null,
    categorisationStatus: "categorisationStatus" in row ? row.categorisationStatus : "pending",
  }));
  return (
    <>
      <PageHeading title="Analysis">
        <Button
          variant="outlined"
          startIcon={<Icon name="refresh" />}
          loading={refresh.isPending}
          disabled={waiting || status.data?.syncing}
          onClick={() => refresh.mutate()}
        >
          Refresh transactions
        </Button>
      </PageHeading>
      <Stack spacing={2} sx={{ mb: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 0.5 }}>
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>
            {status.data?.lastSyncedAt
              ? `Updated ${new Date(status.data.lastSyncedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
              : "Waiting for your first import"}
          </Typography>
        </Stack>
        {(status.data?.syncing || status.data?.backfilling) && (
          <Alert severity="info">
            {status.data.syncing
              ? "Transaction sync is running."
              : "Importing older transactions. More history is added every five minutes. You can browse what’s already here."}
          </Alert>
        )}
        {status.data?.error && (
          <Alert severity="warning">
            {status.data.error}
            {waiting && ` Retry after ${new Date(retryAt!).toLocaleTimeString("en-GB")}.`}
          </Alert>
        )}
        {(transactions.isError || status.isError || refresh.isError || exclude.isError) && (
          <Alert
            severity="error"
            action={
              <Button
                onClick={() => {
                  void transactions.refetch();
                  void status.refetch();
                }}
              >
                Retry
              </Button>
            }
          >
            {errorMessage(exclude.error ?? refresh.error ?? transactions.error ?? status.error)}
          </Alert>
        )}
      </Stack>
      <AnalysisInsights
        selectedMonth={selectedMonth}
        onMonthChange={(value) => {
          setSelectedMonth(value);
          setCursors([undefined]);
          setPageIndex(0);
        }}
      />
      <BudgetTracking
        plan={data.budget?.plan ?? null}
        selectedMonth={selectedMonth}
        links={categories.data?.categories ?? []}
      />
      <CategoriesPanel
        budgetCategories={data.budget ? [...monthlyBudgets(data.budget.plan).keys()] : []}
      />
      <DataTable
        id="analysis"
        loading={transactions.isPending || transactions.isPlaceholderData}
        label="Transactions"
        data={data}
        rows={rows}
        rowId={(row) => `${row.accountId}:${row.id}`}
        columns={[
          {
            id: "date",
            label: "Date",
            minWidth: 120,
            value: (row) => row.booking_date,
            sortable: false,
            render: (row) =>
              new Date(`${row.booking_date}T00:00:00`).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              }),
          },
          {
            id: "account",
            label: "Account",
            minWidth: 155,
            render: (row) => (
              <Box sx={{ whiteSpace: "normal" }}>
                <Typography sx={{ fontSize: 13 }}>{row.accountName}</Typography>
                <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                  {row.institution}
                </Typography>
              </Box>
            ),
            value: (row) => `${row.institution} · ${row.accountName}`,
            sortable: false,
          },
          {
            id: "description",
            label: "Description",
            minWidth: 225,
            value: (row) => row.description,
            sortable: false,
            render: (row) => (
              <Box sx={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                {row.description}
                {row.sandbox && (
                  <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                    Sandbox
                  </Typography>
                )}
              </Box>
            ),
          },
          {
            id: "merchant",
            label: "Merchant",
            minWidth: 155,
            render: (row) => (
              <Box sx={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                {row.enrichment.merchant_name ?? row.counterparty ?? "—"}
              </Box>
            ),
            value: (row) => row.enrichment.merchant_name ?? row.counterparty,
            sortable: false,
          },
          {
            id: "category",
            label: "Category",
            minWidth: 205,
            value: (row) => row.customCategory,
            sortable: false,
            render: (row) => (
              <CategoryPill
                id={row.classification?.categoryId ?? null}
                name={row.customCategory}
                label={`Change category for ${row.description}`}
                disabled={!categories.data?.version}
                categories={categories.data?.categories ?? []}
                onCommit={async (categoryId) => {
                  await api.categories.assign.mutate({
                    accountId: row.accountId,
                    transactionId: row.id,
                    categoryId,
                    expectedVersion: row.classification?.version ?? 0,
                  });
                  await Promise.all([
                    client.invalidateQueries({ queryKey: ["endute-transactions"] }),
                    client.invalidateQueries({ queryKey: ["purchase-categories"] }),
                    client.invalidateQueries({ queryKey: ["transaction-insights"] }),
                  ]);
                }}
              />
            ),
          },
          {
            id: "amount",
            label: "Amount",
            minWidth: 130,
            align: "right",
            value: (row) => row.amount,
            sortable: false,
            render: (row) => (
              <Box
                sx={{
                  fontWeight: 600,
                  color: row.excluded
                    ? "text.disabled"
                    : Number(row.amount) > 0
                      ? "success.main"
                      : "text.primary",
                }}
              >
                {Number(row.amount) > 0 ? "+" : ""}
                {new Intl.NumberFormat("en-GB", {
                  style: "currency",
                  currency: row.currency,
                }).format(Number(row.amount))}
              </Box>
            ),
          },
          {
            id: "excluded",
            label: "Exclude",
            minWidth: 90,
            align: "right",
            value: (row) => (row.excluded ? "Excluded" : null),
            sortable: false,
            render: (row) => (
              <Checkbox
                size="small"
                checked={row.excluded}
                disabled={
                  exclude.isPending &&
                  exclude.variables.accountId === row.accountId &&
                  exclude.variables.transactionId === row.id
                }
                slotProps={{ input: { "aria-label": `Exclude ${row.description} from analysis` } }}
                onChange={(event) =>
                  exclude.mutate({
                    accountId: row.accountId,
                    transactionId: row.id,
                    excluded: event.target.checked,
                  })
                }
              />
            ),
          },
          {
            id: "currency",
            label: "Currency",
            minWidth: 110,
            value: (row) => row.currency,
            sortable: false,
          },
        ]}
        pagination={{
          pageIndex,
          resetKey: selectedMonth,
          knownPageCount: cursors.length,
          hasNext: !transactions.isPlaceholderData && !!transactions.data?.nextCursor,
          loading: transactions.isFetching,
          onPage: setPageIndex,
          onNext: () => {
            if (!transactions.isPlaceholderData && transactions.data?.nextCursor) {
              setCursors((previous) => [
                ...previous.slice(0, pageIndex + 1),
                transactions.data!.nextCursor!,
              ]);
              setPageIndex((previous) => previous + 1);
            }
          },
        }}
      />
    </>
  );
}
