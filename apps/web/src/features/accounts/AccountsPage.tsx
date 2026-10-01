import { AccountCharts } from "./AccountCharts";
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
  Stack,
  TextField,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { MoneyField, nullableMoney, moneyInput } from "../../components/Fields";
import { accountKindLabels, manualAccountKinds, isCashAccount } from "@wealth/domain";
import type { ManualAccountKind, ManualAccount, Pence } from "@wealth/domain";
import type { AppData } from "../../lib/data";
import { errorMessage, useRefresh } from "../../lib/data";
import { api } from "../../lib/api";
import { PageHeading } from "../../components/PageHeading";
import { manualRows } from "../connections/connectionRows";
import { ConnectionsPanel } from "../connections/ConnectionsPanel";
export function AccountsPage({ data }: { readonly data: AppData }) {
  const [editing, setEditing] = useState<ManualAccount | "new" | null>(null);
  return (
    <>
      <PageHeading title="Accounts" />
      <AccountCharts data={data} />
      <ConnectionsPanel
        data={data}
        onAddManual={() => setEditing("new")}
        onEditManual={setEditing}
      />
      {editing && (
        <AccountDialog
          account={editing === "new" ? null : editing}
          balance={
            editing === "new"
              ? null
              : (manualRows([editing], data.snapshots, true)[0]?.total ?? null)
          }
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function AccountDialog({
  account,
  balance,
  onClose,
}: {
  readonly account: ManualAccount | null;
  readonly balance: Pence | null;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(account?.name ?? ""),
    [kind, setKind] = useState<ManualAccountKind>(account?.kind ?? "cash");
  const [value, setValue] = useState(() => moneyInput(balance));
  const [id] = useState(() => account?.id ?? crypto.randomUUID());
  const refresh = useRefresh();
  const save = useMutation({
    mutationFn: () =>
      api.accounts.save.mutate({
        id,
        name,
        kind,
        archived: account?.archived ?? false,
        workingBalance: nullableMoney(value, "Value"),
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
        <DialogTitle>{account ? "Edit account" : "Add manual account"}</DialogTitle>
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
              disabled={!!account && !isCashAccount(account.kind)}
              size="small"
            >
              {manualAccountKinds
                .filter((value) => !account || !isCashAccount(account.kind) || isCashAccount(value))
                .map((value) => (
                  <MenuItem key={value} value={value}>
                    {accountKindLabels[value]}
                  </MenuItem>
                ))}
            </TextField>
            <MoneyField label="Value" value={value} onChange={setValue} />
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
