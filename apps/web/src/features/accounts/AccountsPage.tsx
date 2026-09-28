import { AccountCharts } from "./AccountCharts";
import { moneyGroupTotal } from "../../components/table/groupTotals";
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { readMoney, moneyInput } from "../../components/Fields";
import { DataTable } from "../../components/table/DataTable";
import { EditableCell } from "../../components/table/EditableCell";
import { useTableSave } from "../../components/table/useTableSave";
import { accountKindLabels, manualAccountKinds, isCashAccount } from "@wealth/domain";
import type { ManualAccountKind, ManualAccount } from "@wealth/domain";
import type { AppData } from "../../lib/data";
import { errorMessage, useRefresh } from "../../lib/data";
import { api } from "../../lib/api";
import { PageHeading } from "../../components/PageHeading";
import { ConnectionsPanel } from "../connections/ConnectionsPanel";
export function AccountsPage({ data }: { readonly data: AppData }) {
  const [editing, setEditing] = useState<ManualAccount | "new" | null>(null),
    [showArchived, setShowArchived] = useState(false);
  const saving = useTableSave();
  const update = (account: ManualAccount, patch: Partial<ManualAccount>) =>
    saving.save(() =>
      api.accounts.save.mutate({ ...account, ...patch, expectedVersion: account.version }),
    );
  const balance = (account: ManualAccount) =>
    account.workingBalance ??
    [...data.snapshots]
      .reverse()
      .flatMap((snapshot) => snapshot.balances)
      .find((row) => row.accountId === account.id)?.balance;
  return (
    <>
      <PageHeading title="Accounts">
        <Button variant="contained" onClick={() => setEditing("new")}>
          Add account
        </Button>
      </PageHeading>
      <AccountCharts data={data} />
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack
          direction="row"
          sx={{
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1,
            mb: 2,
          }}
        >
          <Typography component="h2" sx={{ fontWeight: 550, fontSize: 17 }}>
            Manually tracked accounts
          </Typography>
          <Button size="small" onClick={() => setShowArchived((value) => !value)}>
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
        </Stack>
        {saving.status}
        <DataTable
          id="accounts"
          defaultGrouping={["kind"]}
          label="Manually tracked accounts"
          data={data}
          rows={data.accounts.filter(
            (account) => !account.automation && (showArchived || !account.archived),
          )}
          rowId={(account) => account.id}
          reorder
          disabled={saving.disabled}
          columns={[
            {
              id: "name",
              label: "Account",
              minWidth: 240,
              value: (account) => account.name,
              render: (account) => (
                <EditableCell
                  label={account.name + " name"}
                  value={account.name}
                  disabled={saving.disabled}
                  onCommit={(name) => {
                    if (!name.trim()) throw new Error("Enter an account name.");
                    return update(account, { name });
                  }}
                />
              ),
            },
            {
              id: "kind",
              label: "Type",
              groupable: true,
              value: (account) => accountKindLabels[account.kind],
              render: (account) =>
                isCashAccount(account.kind) ? (
                  <EditableCell
                    label={account.name + " type"}
                    value={account.kind}
                    disabled={saving.disabled}
                    options={[
                      { value: "cash", label: "Cash" },
                      { value: "debt", label: "Debt" },
                    ]}
                    onCommit={(kind) => update(account, { kind: kind as "cash" | "debt" })}
                  />
                ) : (
                  accountKindLabels[account.kind]
                ),
            },
            {
              id: "balance",
              aggregate: (rows) => moneyGroupTotal(rows, balance),
              label: "Working balance",
              value: (account) => balance(account) ?? null,
              align: "right",
              render: (account) => (
                <EditableCell
                  label={account.name + " balance"}
                  numeric
                  value={moneyInput(balance(account))}
                  disabled={saving.disabled || account.archived}
                  onCommit={(value) =>
                    update(account, { workingBalance: readMoney(value, account.name) })
                  }
                />
              ),
            },
            {
              id: "status",
              label: "Status",
              groupable: true,
              value: (account) => (account.archived ? "Archived" : "Active"),
            },
            {
              id: "actions",
              label: "Actions",
              sortable: false,
              value: () => "",
              render: (account) => (
                <Button
                  size="small"
                  disabled={saving.disabled}
                  onClick={() =>
                    void update(account, { archived: !account.archived }).catch(() => {})
                  }
                >
                  {account.archived ? "Restore" : "Archive"}
                </Button>
              ),
            },
          ]}
        />
      </Paper>
      <ConnectionsPanel data={data} />
      {editing && (
        <AccountDialog
          account={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
function AccountDialog({
  account,
  onClose,
}: {
  readonly account: ManualAccount | null;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(account?.name ?? ""),
    [kind, setKind] = useState<ManualAccountKind>(account?.kind ?? "cash");
  const [id] = useState(() => account?.id ?? crypto.randomUUID());
  const refresh = useRefresh();
  const save = useMutation({
    mutationFn: () =>
      api.accounts.save.mutate({
        id,
        name,
        kind,
        archived: account?.archived ?? false,
        expectedVersion: account?.version ?? 0,
      }),
    onSuccess: () => {
      void refresh();
      onClose();
    },
  });
  return (
    <Dialog open onClose={save.isPending ? undefined : onClose} fullWidth maxWidth="xs">
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <DialogTitle>{account ? "Edit account" : "Add account"}</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
            <TextField
              label="Account name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              size="small"
              fullWidth
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
            <TextField
              select
              label="Type"
              helperText={
                kind === "debt"
                  ? "Enter amounts owed as negative balances."
                  : kind === "investment"
                    ? "Included in net worth. Savings and spending metrics are unavailable for intervals involving manual investments."
                    : undefined
              }
              value={kind}
              onChange={(event) => setKind(event.target.value as ManualAccountKind)}
              disabled={!!account}
              size="small"
            >
              {manualAccountKinds.map((value) => (
                <MenuItem key={value} value={value}>
                  {accountKindLabels[value]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={save.isPending}>
            Save account
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
