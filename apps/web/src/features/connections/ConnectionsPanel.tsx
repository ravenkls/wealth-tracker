import { moneyGroupTotal } from "../../components/table/groupTotals";
import { DataTable } from "../../components/table/DataTable";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { formatGbp } from "@wealth/domain";
import type { PublicConnection } from "@wealth/domain";
import type { AppData } from "../../lib/data";
import { errorMessage, useRefresh } from "../../lib/data";
import { api } from "../../lib/api";
export function ConnectionsPanel({ data }: { readonly data: AppData }) {
  const [open, setOpen] = useState(false),
    [disconnect, setDisconnect] = useState<PublicConnection | null>(null),
    [holdings, setHoldings] = useState<PublicConnection | null>(null);
  const refresh = useRefresh();
  const action = useMutation({
    mutationFn: async (input: {
      id: string;
      kind: "refresh" | "history" | "resume" | "disconnect";
      version?: number;
    }) => {
      if (input.kind === "refresh") return api.connections.refresh.mutate({ id: input.id });
      if (input.kind === "resume") return api.connections.historyStep.mutate({ id: input.id });
      if (input.kind === "history") return api.connections.historyStart.mutate({ id: input.id });
      return api.connections.disconnect.mutate({ id: input.id, version: input.version! });
    },
    onSuccess: () => {
      void refresh();
      setDisconnect(null);
    },
    onError: () => {
      void refresh();
    },
  });
  return (
    <>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 3 }}>
        <Stack
          direction="row"

          spacing={2}
          sx={{
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1,
            mb: 2,
          }}
        >
          <Typography component="h2" sx={{ fontWeight: 550, fontSize: 17 }}>
            Automated tracking accounts
          </Typography>
          <Button onClick={() => setOpen(true)}>Connect account</Button>
        </Stack>
        {action.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorMessage(action.error)}
          </Alert>
        )}
        {data.connections.length === 0 && (
          <Typography color="text.secondary">
            Connect a Trading 212 Invest or Stocks ISA account with read-only API credentials.
          </Typography>
        )}
        <DataTable
          id="connections"
          label="Automated tracking accounts"
          data={data}
          rows={data.connections}
          rowId={(connection) => connection.id}
          reorder
          disabled={action.isPending}
          columns={[
            { id: "name", label: "Account", value: (connection) => connection.name },
            { id: "provider", label: "Provider", value: () => "Trading 212" },
            {
              id: "type",
              label: "Type",
              groupable: true,
              value: (connection) => (connection.accountType === "isa" ? "Stocks ISA" : "Invest"),
            },
            {
              id: "value",
              aggregate: (rows) => moneyGroupTotal(rows, (row) => row.valuation.total),
              label: "Value",
              align: "right",
              value: (connection) => connection.valuation.total,
              render: (connection) => formatGbp(connection.valuation.total),
            },
            {
              id: "valued",
              label: "Valued",
              value: (connection) => connection.valuation.fetchedAt,
              render: (connection) =>
                new Date(connection.valuation.fetchedAt).toLocaleString("en-GB"),
            },
            {
              id: "history",
              label: "Cash history",
              value: (connection) =>
                connection.history.error ??
                (connection.history.completedAt ? "Up to date" : "Reading…"),
              render: (connection) => (
                <Typography
                  sx={{ fontSize: 12, maxWidth: 240, whiteSpace: "normal" }}
                  color={connection.history.error ? "warning.main" : "text.secondary"}
                >
                  {connection.history.error ??
                    (connection.history.completedAt ? "Up to date" : "Reading…")}
                </Typography>
              ),
            },
            {
              id: "actions",
              label: "Actions",
              sortable: false,
              value: () => "",
              render: (connection) => (
                <Stack
                  direction="row"
                  sx={{ flexWrap: "wrap", gap: 0.5, minWidth: 240, maxWidth: 320 }}
                >
                  <Button size="small" onClick={() => setHoldings(connection)}>
                    Holdings
                  </Button>
                  <Button
                    size="small"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: connection.id, kind: "refresh" })}
                  >
                    Refresh values
                  </Button>
                  <Button
                    size="small"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({
                        id: connection.id,
                        kind: connection.history.error ? "resume" : "history",
                      })
                    }
                  >
                    {connection.history.error ? "Retry history" : "Refresh history"}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      action.reset();
                      setDisconnect(connection);
                    }}
                  >
                    Disconnect
                  </Button>
                </Stack>
              ),
            },
          ]}
        />
      </Paper>
      {open && <ConnectDialog onClose={() => setOpen(false)} />}
      <Dialog open={!!disconnect} onClose={() => setDisconnect(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Disconnect {disconnect?.name}?</DialogTitle>
        <DialogContent>
          Saved snapshots will remain. The stored API credentials will be removed.
          {action.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errorMessage(action.error)} Cancel and reopen this dialog to reload.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnect(null)}>Cancel</Button>
          <Button
            color="error"
            disabled={action.isPending}
            onClick={() =>
              disconnect &&
              action.mutate({ id: disconnect.id, kind: "disconnect", version: disconnect.version })
            }
          >
            Disconnect
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!holdings} onClose={() => setHoldings(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{holdings?.name}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Cash within account: {holdings ? formatGbp(holdings.valuation.cash) : ""}
          </Typography>
          {holdings?.valuation.positions.length === 0 && (
            <Typography>No open positions.</Typography>
          )}
          {holdings?.valuation.positions.map((position) => (
            <Stack
              key={position.ticker}
              direction="row"

              spacing={2}
              sx={{
                justifyContent: "space-between",
                py: 1.5,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ overflowWrap: "anywhere" }}>{position.name}</Typography>
                <Typography sx={{ fontSize: 12 }} color="text.secondary">
                  {position.quantity} shares: {position.ticker}
                </Typography>
              </Box>
              <Typography sx={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                {formatGbp(position.value)}
              </Typography>
            </Stack>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHoldings(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
function ConnectDialog({ onClose }: { readonly onClose: () => void }) {
  const [name, setName] = useState(""),
    [accountType, setType] = useState<"invest" | "isa">("isa"),
    [apiKey, setKey] = useState(""),
    [apiSecret, setSecret] = useState("");
  const refresh = useRefresh();
  const connect = useMutation({
    mutationFn: () => api.connections.connect.mutate({ name, accountType, apiKey, apiSecret }),
    onSuccess: () => {
      setKey("");
      setSecret("");
      void refresh();
      onClose();
    },
  });
  return (
    <Dialog open onClose={connect.isPending ? undefined : onClose} fullWidth maxWidth="xs">
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          connect.mutate();
        }}
      >
        <DialogTitle>Connect Trading 212</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {connect.isError && <Alert severity="error">{errorMessage(connect.error)}</Alert>}
            <TextField
              size="small"
              label="Account name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              select
              size="small"
              label="Account type"
              value={accountType}
              onChange={(event) => setType(event.target.value as "invest" | "isa")}
            >
              <MenuItem value="isa">Stocks ISA</MenuItem>
              <MenuItem value="invest">Invest</MenuItem>
            </TextField>
            <TextField
              size="small"
              label="API key"
              type="password"
              required
              value={apiKey}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
            />
            <TextField
              size="small"
              label="API secret"
              type="password"
              required
              value={apiSecret}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="off"
            />
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>
              Enable read permissions for account data, positions, transactions and dividends.
              Trading permissions are not needed. The account must report in GBP.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={connect.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={connect.isPending}>
            Connect account
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
