import { HistoryCharts } from "./HistoryCharts";
import { DataTable } from "../../components/table/DataTable";
import { EditableCell } from "../../components/table/EditableCell";
import { useTableSave } from "../../components/table/useTableSave";
import { moneyInput, readMoney, nullableMoney } from "../../components/Fields";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { formatGbp, formatMonth, pence } from "@wealth/domain";
import type { Snapshot } from "@wealth/domain";
import type { AppData } from "../../lib/data";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/data";
import { PageHeading } from "../../components/PageHeading";
import { SnapshotDialog } from "../snapshots/SnapshotDialog";
export function HistoryPage({ data }: { readonly data: AppData }) {
  const [edit, setEdit] = useState(false),
    [detailMonth, setDetailMonth] = useState<string | null>(null);
  const detail = data.snapshots.find((snapshot) => snapshot.month === detailMonth);
  const saving = useTableSave();
  type Change = Parameters<typeof api.snapshots.inlineCorrect.mutate>[0]["change"];
  const correct = (snapshot: Snapshot, change: Change) => {
    const input = {
      month: snapshot.month,
      expectedVersion: snapshot.version,
      operationId: crypto.randomUUID(),
      change,
    };
    return saving.save(() => api.snapshots.inlineCorrect.mutate(input));
  };
  return (
    <>
      <PageHeading title="History">
        <Button variant="contained" onClick={() => setEdit(true)}>
          Add past month
        </Button>
      </PageHeading>
      <HistoryCharts data={data} />
      {saving.status}
      <DataTable
        id="history"
        label="Monthly snapshots"
        data={data}
        rows={[...data.snapshots].reverse()}
        rowId={(snapshot) => snapshot.month}
        disabled={saving.disabled}
        columns={[
          {
            id: "month",
            label: "Month",
            value: (row) => row.month,
            render: (row) => formatMonth(row.month),
          },
          { id: "year", label: "Year", value: (row) => row.month.slice(0, 4), groupable: true },
          ...(["cash", "investmentTotal", "pensions"] as const).map((field) => ({
            id: field,
            label:
              field === "investmentTotal" ? "Investments" : field === "cash" ? "Cash" : "Pensions",
            align: "right" as const,
            value: (row: Snapshot) => row[field],
            render: (row: Snapshot) =>
              row.source === "historical" ? (
                <EditableCell
                  numeric
                  label={row.month + " " + field}
                  value={moneyInput(row[field])}
                  disabled={saving.disabled}
                  onCommit={(value) => correct(row, { field, value: readMoney(value, field) })}
                />
              ) : (
                formatGbp(row[field])
              ),
          })),
          {
            id: "total",
            label: "Net worth",
            align: "right",
            value: (row) => row.total,
            render: (row) => formatGbp(row.total),
          },
          {
            id: "source",
            label: "Source",
            groupable: true,
            value: (row) => (row.source === "historical" ? "Manual totals" : "Recorded balances"),
          },
          {
            id: "notes",
            label: "Notes",
            minWidth: 260,
            value: (row) => row.notes,
            render: (row) => (
              <EditableCell
                multiline
                label={row.month + " notes"}
                value={row.notes}
                disabled={saving.disabled}
                onCommit={(value) => correct(row, { field: "notes", value })}
              />
            ),
          },
          {
            id: "actions",
            label: "Actions",
            sortable: false,
            value: () => "",
            render: (row) => (
              <Button size="small" onClick={() => setDetailMonth(row.month)}>
                Details
              </Button>
            ),
          },
        ]}
      />
      {edit && <SnapshotDialog data={data} mode="historical" onClose={() => setEdit(false)} />}
      {detail && (
        <SnapshotDetails
          snapshot={detail}
          previous={
            data.snapshots.filter((snapshot) => snapshot.month < detail.month).at(-1) ?? null
          }
          metrics={data.metrics.find((entry) => entry.month === detail.month)?.result ?? null}
          disabled={saving.disabled}
          status={saving.status}
          onCorrect={(change) => correct(detail, change)}
          onClose={() => setDetailMonth(null)}
        />
      )}
    </>
  );
}
function SnapshotDetails({
  snapshot,
  previous,
  metrics,
  onClose,
  disabled,
  status,
  onCorrect,
}: {
  readonly disabled: boolean;
  readonly status: import("react").ReactNode;
  readonly onCorrect: (
    change: Parameters<typeof api.snapshots.inlineCorrect.mutate>[0]["change"],
  ) => Promise<unknown>;
  readonly snapshot: Snapshot;
  readonly previous: Snapshot | null;
  readonly metrics: AppData["metrics"][number]["result"] | null;
  readonly onClose: () => void;
}) {
  const [showRevisions, setShowRevisions] = useState(false);
  const revisions = useQuery({
    queryKey: ["revisions", snapshot.month, snapshot.version],
    queryFn: () => api.snapshots.revisions.query({ month: snapshot.month }),
    enabled: showRevisions,
  });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{formatMonth(snapshot.month)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {status}
          {previous && (
            <Typography color="text.secondary">
              Change since {formatMonth(previous.month)}:{" "}
              {formatGbp(pence(snapshot.total - previous.total))}
            </Typography>
          )}
          {[
            ["Cash", snapshot.cash],
            ["Investments", snapshot.investmentTotal],
            ["Pensions", snapshot.pensions],
            ["Net worth", snapshot.total],
          ].map(([name, value]) => (
            <Stack
              key={name}
              direction="row"
              sx={{ justifyContent: "space-between", alignItems: "center", gap: 2 }}
            >
              <Typography>{name}</Typography>
              <Typography>{formatGbp(value as Snapshot["total"])}</Typography>
            </Stack>
          ))}
          {snapshot.balances.map((balance) => (
            <Stack
              direction="row"
              key={balance.accountId}
              sx={{ justifyContent: "space-between", alignItems: "center", gap: 2 }}
            >
              <Typography color="text.secondary" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                {balance.name}
              </Typography>
              {balance.automation ? (
                <Typography>{formatGbp(balance.balance)}</Typography>
              ) : (
                <EditableCell
                  numeric
                  label={balance.name + " recorded balance"}
                  value={moneyInput(balance.balance)}
                  disabled={disabled}
                  onCommit={(value) =>
                    onCorrect({
                      field: "balance",
                      accountId: balance.accountId,
                      value: readMoney(value, balance.name),
                    })
                  }
                />
              )}
            </Stack>
          ))}
          {snapshot.capturedAt && (
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>
              Balances captured {new Date(snapshot.capturedAt).toLocaleString("en-GB")}
            </Typography>
          )}
          {snapshot.historicalSavings && (
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>
              Balances read on{" "}
              {new Date(`${snapshot.historicalSavings.readingDate}T12:00:00Z`).toLocaleDateString(
                "en-GB",
                { timeZone: "Europe/London" },
              )}
              .
              {snapshot.historicalSavings.assumedMonthlyIncome !== null && (
                <>
                  {" "}
                  Income assumes {formatGbp(snapshot.historicalSavings.assumedMonthlyIncome)} per
                  month across the interval.
                </>
              )}
            </Typography>
          )}
          {(snapshot.source === "current" || snapshot.historicalSavings) &&
            (["periodIncome", "cashPensionContributions"] as const).map((field) => (
              <Stack
                key={field}
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{
                  alignItems: { xs: "stretch", sm: "center" },
                  justifyContent: "space-between",
                }}
              >
                <Typography>
                  {field === "periodIncome"
                    ? snapshot.historicalSavings?.assumedMonthlyIncome != null
                      ? "Assumed interval income"
                      : "Confirmed interval income"
                    : "Pension contributions paid from cash"}
                </Typography>
                <EditableCell
                  numeric
                  label={field}
                  value={moneyInput(snapshot[field])}
                  disabled={disabled}
                  onCommit={(value) => onCorrect({ field, value: nullableMoney(value, field) })}
                />
              </Stack>
            ))}
          {metrics?.status === "complete" ? (
            <Box>
              <Typography>Saved: {formatGbp(metrics.saved)}</Typography>
              <Typography>Inferred spending: {formatGbp(metrics.spending)}</Typography>
              <Typography>
                Savings rate: {metrics.rate === null ? "—" : `${(metrics.rate * 100).toFixed(1)}%`}
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                {new Date(metrics.start).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}{" "}
                – {new Date(metrics.end).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}
              </Typography>
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>
              {metrics?.reason}
            </Typography>
          )}
          {snapshot.notes && (
            <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {snapshot.notes}
            </Typography>
          )}
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>
            Updated {new Date(snapshot.updatedAt).toLocaleString("en-GB")}: Revision{" "}
            {snapshot.version}
          </Typography>
          {snapshot.investments.map((investment) => (
            <Typography key={investment.connectionId} color="text.secondary" sx={{ fontSize: 12 }}>
              {investment.name}: valued {new Date(investment.fetchedAt).toLocaleString("en-GB")}
            </Typography>
          ))}
          <Button
            sx={{ alignSelf: "flex-start" }}
            onClick={() => setShowRevisions((value) => !value)}
          >
            {showRevisions ? "Hide revisions" : "Show revisions"}
          </Button>
          {showRevisions && revisions.isPending && <Typography>Loading revisions…</Typography>}
          {revisions.isError && <Alert severity="error">{errorMessage(revisions.error)}</Alert>}
          {showRevisions &&
            revisions.data?.map((revision) => (
              <Box
                key={revision.version}
                sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}
              >
                <Typography>
                  Revision {revision.version}: {formatGbp(revision.total)}
                </Typography>
                <Typography sx={{ fontSize: 12 }} color="text.secondary">
                  {new Date(revision.updatedAt).toLocaleString("en-GB")}
                </Typography>
                <Box sx={{ mt: 1.5 }}>
                  {[
                    ["Cash", revision.cash],
                    ["Investments", revision.investmentTotal],
                    ["Pensions", revision.pensions],
                  ].map(([label, value]) => (
                    <Box
                      key={label}
                      sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 0.5 }}
                    >
                      <Typography sx={{ fontSize: 13 }} color="text.secondary">
                        {label}
                      </Typography>
                      <Typography sx={{ fontSize: 13, whiteSpace: "nowrap" }}>
                        {formatGbp(value as Snapshot["total"])}
                      </Typography>
                    </Box>
                  ))}
                </Box>
                {revision.balances.map((balance) => (
                  <Typography key={balance.accountId} sx={{ fontSize: 13, mt: 1 }}>
                    {balance.name}: {formatGbp(balance.balance)}
                  </Typography>
                ))}
                {revision.investments.map((investment) => (
                  <Typography key={investment.connectionId} sx={{ fontSize: 13, mt: 1 }}>
                    {investment.name}: {formatGbp(investment.total)};{" "}
                    {new Date(investment.fetchedAt).toLocaleString("en-GB")}
                  </Typography>
                ))}
                {revision.periodIncome !== null && (
                  <Typography sx={{ fontSize: 13, mt: 1 }}>
                    Interval income: {formatGbp(revision.periodIncome)}
                  </Typography>
                )}
                {revision.cashPensionContributions !== null && (
                  <Typography sx={{ fontSize: 13, mt: 1 }}>
                    Pension payments from cash: {formatGbp(revision.cashPensionContributions)}
                  </Typography>
                )}
                {revision.notes && (
                  <Typography
                    sx={{ fontSize: 13, mt: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {revision.notes}
                  </Typography>
                )}
              </Box>
            ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
