import { SnapshotBalancesTable } from "./SnapshotBalancesTable";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { formatGbp, formatMonth, month, sumMoney, readingAt } from "@wealth/domain";
import type { Snapshot } from "@wealth/domain";
import { MoneyField, moneyInput, nullableMoney, readMoney } from "../../components/Fields";
import { api } from "../../lib/api";
import { errorMessage, useRefresh } from "../../lib/data";
import type { AppData } from "../../lib/data";
export function SnapshotDialog({
  data,
  mode,
  initial,
  onClose,
}: {
  readonly data: AppData;
  readonly mode: "current" | "historical" | "correction";
  readonly initial?: Snapshot;
  readonly onClose: () => void;
}) {
  const refresh = useRefresh();
  const [period, setPeriod] = useState<string>(
    initial?.month ?? (mode === "current" ? data.currentMonth : ""),
  );
  const [existing, setExisting] = useState<Snapshot | null>(
    initial ??
      (mode === "current"
        ? (data.snapshots.find((snapshot) => snapshot.month === data.currentMonth) ?? null)
        : null),
  );
  const rows =
    mode === "correction"
      ? initial!.balances
          .filter((balance) => !balance.automation)
          .map((balance) => ({
            id: balance.accountId,
            name: balance.name,
            kind: balance.kind,
            archived:
              data.accounts.find((account) => account.id === balance.accountId)?.archived ?? false,
          }))
      : data.accounts.filter((account) => !account.archived && !account.automation);
  const priorBalance = (id: string) =>
    [...data.snapshots]
      .reverse()
      .flatMap((snapshot) =>
        snapshot.balances
          .filter((balance) => balance.accountId === id)
          .map((balance) => ({ value: balance.balance, month: snapshot.month })),
      )[0];
  const [balances, setBalances] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.id,
        moneyInput(
          initial?.balances.find((balance) => balance.accountId === row.id)?.balance ??
            (mode === "current"
              ? data.accounts.find((account) => account.id === row.id)?.workingBalance
              : undefined) ??
            priorBalance(row.id)?.value,
        ),
      ]),
    ),
  );
  const [cash, setCash] = useState(moneyInput(initial?.cash)),
    [investments, setInvestments] = useState(moneyInput(initial?.investmentTotal)),
    [pensions, setPensions] = useState(moneyInput(initial?.pensions));
  const [income, setIncome] = useState(
      moneyInput(initial?.periodIncome ?? data.budgetSummary?.income),
    ),
    [pensionCash, setPensionCash] = useState(moneyInput(initial?.cashPensionContributions ?? 0)),
    [notes, setNotes] = useState(initial?.notes ?? ""),
    [confirmed, setConfirmed] = useState(false),
    [localError, setLocalError] = useState("");
  const operation = useRef({ signature: "", id: crypto.randomUUID() });
  const save = useMutation({
    mutationFn: async () => {
      setLocalError("");
      const selectedMonth = month(period);
      const base = {
        month: selectedMonth,
        expectedVersion: existing?.version ?? 0,
        replaceConfirmed: confirmed,
        notes,
      };
      const values =
        mode === "historical"
          ? {
              ...base,
              cash: readMoney(cash, "Cash"),
              investments: readMoney(investments, "Investments"),
              pensions: readMoney(pensions, "Pensions"),
            }
          : {
              ...base,
              balances: rows.map((row) => ({
                accountId: row.id,
                balance: readMoney(balances[row.id] ?? "", row.name),
              })),
              periodIncome: nullableMoney(income, "Income"),
              cashPensionContributions: nullableMoney(pensionCash, "Pension contributions"),
            };
      const signature = JSON.stringify({ mode, ...values });
      if (signature !== operation.current.signature)
        operation.current = { signature, id: crypto.randomUUID() };
      const input = { ...values, operationId: operation.current.id };
      if ("cash" in input) return api.snapshots.historical.mutate(input);
      return mode === "correction"
        ? api.snapshots.correct.mutate(input)
        : api.snapshots.record.mutate(input);
    },
    onError: () => {
      void refresh();
    },
    onSuccess: async () => {
      if (mode === "current")
        await Promise.allSettled(
          data.connections.map((connection) =>
            api.connections.historyStart.mutate({ id: connection.id }),
          ),
        );
      await refresh();
      onClose();
    },
  });
  const previous = existing
    ? data.snapshots.filter((snapshot) => snapshot.month < existing.month).at(-1)
    : data.snapshots.at(-1);
  const previousReading = previous ? readingAt(previous) : null;
  const hasManualInvestments =
    rows.some((row) => row.kind === "investment") ||
    previous?.balances.some((row) => row.kind === "investment");
  function selectMonth(value: string) {
    setPeriod(value);
    setExisting(data.snapshots.find((snapshot) => snapshot.month === value) ?? null);
    setConfirmed(false);
  }
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={save.isPending ? undefined : onClose}>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (existing && !confirmed) {
            setLocalError("Confirm replacing the saved month.");
            return;
          }
          save.mutate();
        }}
      >
        <DialogTitle>
          {mode === "current"
            ? "Record snapshot"
            : mode === "historical"
              ? "Monthly totals"
              : "Correct snapshot"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {(save.isError || localError) && (
              <Alert severity="error">{localError || errorMessage(save.error)}</Alert>
            )}
            <TextField
              label="Month"
              type="month"
              value={period}
              onChange={(event) => selectMonth(event.target.value)}
              disabled={mode !== "historical" || !!initial}
              required
              slotProps={{ inputLabel: { shrink: true } }}
              size="small"
            />
            {existing && (
              <Alert severity="warning">
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                  }
                  label={`Replace the saved ${formatMonth(existing.month)} snapshot`}
                />
                <Typography sx={{ fontSize: 12 }}>
                  The previous revision will remain available.
                </Typography>
              </Alert>
            )}
            {mode === "historical" ? (
              <>
                <MoneyField
                  label="Net cash (including debts)"
                  value={cash}
                  onChange={setCash}
                  required
                />
                <MoneyField
                  label="Investments"
                  value={investments}
                  onChange={setInvestments}
                  required
                />
                <MoneyField label="Pensions" value={pensions} onChange={setPensions} required />
              </>
            ) : (
              <>
                <SnapshotBalancesTable
                  density="compact"
                  rows={rows}
                  balances={balances}
                  onChange={(id, value) => setBalances((current) => ({ ...current, [id]: value }))}
                  preferences={data.preferences.find((item) => item.id === "accounts")?.preferences}
                  previousBalance={priorBalance}
                  disabled={save.isPending}
                />
                {mode === "current" &&
                  (data.connections.length > 0 ||
                    data.accounts.some((account) => account.automation && !account.archived)) && (
                    <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                      Connected account balances will be fetched when you record.
                    </Typography>
                  )}
                {mode === "correction" && initial && initial.investments.length > 0 && (
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                    Recorded automated investments:{" "}
                    {formatGbp(sumMoney(initial.investments.map((investment) => investment.total)))}
                    . Corrections do not fetch new prices.
                  </Typography>
                )}
                {hasManualInvestments ? (
                  <Alert severity="info">
                    This interval includes manually tracked investments. Net worth will be saved,
                    but savings and spending metrics will be unavailable.
                  </Alert>
                ) : (
                  <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
                    <Typography component="h3" sx={{ fontSize: 14, mb: 1 }}>
                      Savings inputs
                    </Typography>
                    <Typography color="text.secondary" sx={{ fontSize: 12, mb: 2 }}>
                      {previousReading
                        ? `Since ${new Date(previousReading).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}`
                        : "Savings metrics need a previous recorded balance reading."}
                    </Typography>
                    <Stack spacing={2.5}>
                      <MoneyField
                        label="Income received in this interval"
                        helperText="Prefilled from your monthly budget. Confirm the income actually received over this interval."
                        value={income}
                        onChange={setIncome}
                      />
                      <MoneyField
                        label="Pension contributions paid from cash"
                        value={pensionCash}
                        onChange={setPensionCash}
                      />
                    </Stack>
                  </Box>
                )}
              </>
            )}
            <TextField
              label="Notes"
              multiline
              minRows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={save.isPending}>
            {mode === "current" ? "Record snapshot" : "Save month"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
