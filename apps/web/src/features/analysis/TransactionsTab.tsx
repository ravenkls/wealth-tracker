import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Checkbox, Typography } from "@mui/material";
import { DataTable } from "../../components/table/DataTable";
import { api, backgroundApi } from "../../lib/api";
import { errorMessage, type AppData } from "../../lib/data";
import { CategoryPill } from "./CategoryPill";
import { useCategories } from "./CategoriesPanel";
import { monthRange } from "./ledgerModel";

export function TransactionsTab({
  data,
  selectedMonth,
}: {
  readonly data: AppData;
  readonly selectedMonth: string;
}) {
  const client = useQueryClient();
  const categories = useCategories();
  const [pages, setPages] = useState({
    month: selectedMonth,
    cursors: [undefined] as (string | undefined)[],
    index: 0,
  });
  // Paging restarts whenever the month changes.
  if (pages.month !== selectedMonth)
    setPages({ month: selectedMonth, cursors: [undefined], index: 0 });
  const { cursors, index: pageIndex } = pages;
  const cursor = cursors[pageIndex];
  const setPageIndex = (index: number | ((previous: number) => number)) =>
    setPages((previous) => ({
      ...previous,
      index: typeof index === "function" ? index(previous.index) : index,
    }));
  const setCursors = (update: (previous: (string | undefined)[]) => (string | undefined)[]) =>
    setPages((previous) => ({ ...previous, cursors: update(previous.cursors) }));
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
  const exclude = useMutation({
    mutationFn: (input: { accountId: string; transactionId: string; excluded: boolean }) =>
      api.analysis.exclude.mutate(input),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["endute-transactions"] }),
        client.invalidateQueries({ queryKey: ["transaction-ledger"] }),
      ]),
  });
  const rows = (transactions.data?.rows ?? []).map((row) => ({
    ...row,
    customCategory: "customCategory" in row ? row.customCategory : null,
    classification: "classification" in row ? row.classification : null,
    categorisationStatus: "categorisationStatus" in row ? row.categorisationStatus : "pending",
  }));
  return (
    <>
      {(transactions.isError || exclude.isError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(exclude.error ?? transactions.error)}
        </Alert>
      )}
      <Typography color="text.secondary" sx={{ fontSize: 12, mb: 1.5 }}>
        Excluded transactions are left out of every chart and total on this page, for example
        transfers between your own accounts.
      </Typography>
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
                    client.invalidateQueries({ queryKey: ["transaction-ledger"] }),
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
