import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { DataTable } from "../../components/table/DataTable";
import { PageHeading } from "../../components/PageHeading";
import { api, backgroundApi } from "../../lib/api";
import { errorMessage, type AppData } from "../../lib/data";

export function AnalysisPage({ data }: { readonly data: AppData }) {
  const client = useQueryClient();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const status = useQuery({
    queryKey: ["endute-sync"],
    queryFn: () => backgroundApi.analysis.status.query(),
    refetchInterval: 15000,
  });
  const transactions = useQuery({
    queryKey: ["endute-transactions", cursor ?? "first"],
    queryFn: () => backgroundApi.analysis.transactions.query(cursor ? { cursor } : {}),
    refetchInterval: 30000,
  });
  const refresh = useMutation({
    mutationFn: () => api.analysis.refresh.mutate(),
    onSuccess: async () => {
      setCursors([undefined]);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["endute-sync"] }),
        client.invalidateQueries({ queryKey: ["endute-transactions"] }),
      ]);
    },
  });
  const retryAt = status.data?.retryAt;
  const waiting = status.data?.retrying ?? false;
  const rows = transactions.data?.rows ?? [];
  return (
    <>
      <PageHeading title="Analysis">
        <Button
          variant="contained"
          loading={refresh.isPending}
          disabled={waiting || status.data?.syncing}
          onClick={() => refresh.mutate()}
        >
          Refresh transactions
        </Button>
      </PageHeading>
      <Stack spacing={2} sx={{ mb: 3 }}>
        <Typography color="text.secondary">
          Transactions from accounts enabled in Endute. Automatic sync runs every five minutes.
        </Typography>
        <Typography color="text.secondary" sx={{ fontSize: 13 }}>
          {status.data?.lastSyncedAt
            ? `Last imported ${new Date(status.data.lastSyncedAt).toLocaleString("en-GB")}.`
            : "No transactions have been imported yet. Refresh to start, or wait for automatic sync."}{" "}
          Endute updates bank data on its own schedule.
        </Typography>
        {(status.data?.syncing || status.data?.backfilling) && (
          <Alert severity="info">
            {status.data.syncing
              ? "Transaction sync is running."
              : "Available history is being imported in batches. Further pages will arrive on subsequent syncs."}
          </Alert>
        )}
        {status.data?.error && (
          <Alert severity="warning">
            {status.data.error}
            {waiting && ` Retry after ${new Date(retryAt!).toLocaleTimeString("en-GB")}.`}
          </Alert>
        )}
        {(transactions.isError || status.isError || refresh.isError) && (
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
            {errorMessage(refresh.error ?? transactions.error ?? status.error)}
          </Alert>
        )}
      </Stack>
      {transactions.isPending ? (
        <CircularProgress aria-label="Loading transactions" />
      ) : (
        <DataTable
          id="analysis"
          label="Endute transactions"
          data={data}
          rows={rows}
          rowId={(row) => `${row.accountId}:${row.id}`}
          columns={[
            { id: "date", label: "Date", value: (row) => row.booking_date, sortable: false },
            {
              id: "account",
              label: "Account",
              value: (row) => `${row.institution} · ${row.accountName}`,
              sortable: false,
            },
            {
              id: "description",
              label: "Description",
              value: (row) => row.description,
              sortable: false,
              render: (row) => (
                <Box sx={{ whiteSpace: "normal", minWidth: 200, maxWidth: 420 }}>
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
              label: "Merchant / counterparty",
              value: (row) => row.enrichment.merchant_name ?? row.counterparty,
              sortable: false,
            },
            {
              id: "category",
              label: "Category",
              value: (row) => row.enrichment.category,
              sortable: false,
            },
            {
              id: "amount",
              label: "Amount",
              align: "right",
              value: (row) => row.amount,
              sortable: false,
              render: (row) =>
                new Intl.NumberFormat("en-GB", {
                  style: "currency",
                  currency: row.currency,
                }).format(Number(row.amount)),
            },
            { id: "currency", label: "Currency", value: (row) => row.currency, sortable: false },
          ]}
          pagination={{
            pageIndex: cursors.length - 1,
            hasNext: !!transactions.data?.nextCursor,
            loading: transactions.isFetching,
            onFirst: () => setCursors([undefined]),
            onPrevious: () => setCursors((previous) => previous.slice(0, -1)),
            onNext: () => {
              if (transactions.data?.nextCursor)
                setCursors((previous) => [...previous, transactions.data!.nextCursor!]);
            },
          }}
        />
      )}
    </>
  );
}
