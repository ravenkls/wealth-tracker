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
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { formatGbp, type ConnectionDisplayMode, type PublicConnection } from "@wealth/domain";
import { api } from "../../lib/api";
import { errorMessage, useRefresh } from "../../lib/data";

export function ManageTradingDialog({
  connection,
  onClose,
}: {
  readonly connection: PublicConnection;
  readonly onClose: () => void;
}) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const refresh = useRefresh();
  const action = useMutation({
    mutationFn: async (kind: "refresh" | "history" | "resume" | "disconnect") => {
      if (kind === "refresh") return api.connections.refresh.mutate({ id: connection.id });
      if (kind === "resume") return api.connections.historyStep.mutate({ id: connection.id });
      if (kind === "history") return api.connections.historyStart.mutate({ id: connection.id });
      return api.connections.disconnect.mutate({ id: connection.id, version: connection.version });
    },
    onSuccess: async (_, kind) => {
      await refresh();
      if (kind === "disconnect") onClose();
    },
    onError: () => {
      void refresh();
    },
  });
  const display = useMutation({
    mutationFn: (displayMode: ConnectionDisplayMode) =>
      api.connections.setDisplayMode.mutate({
        id: connection.id,
        displayMode,
        expectedVersion: connection.version,
      }),
    onSettled: async () => {
      await refresh();
    },
  });
  const disabled = action.isPending || display.isPending;
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={disabled ? undefined : onClose}>
      <DialogTitle>
        {confirmDisconnect ? `Disconnect ${connection.name}?` : "Manage Trading 212"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {action.isError && <Alert severity="error">{errorMessage(action.error)}</Alert>}
          {display.isError && <Alert severity="error">{errorMessage(display.error)}</Alert>}
          {confirmDisconnect ? (
            <Typography>
              Saved snapshots will remain. The stored API credentials will be removed.
            </Typography>
          ) : (
            <>
              <Stack
                direction="row"
                sx={{ justifyContent: "space-between", alignItems: "baseline", gap: 2 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                    {connection.name}
                  </Typography>
                  {connection.name !==
                    (connection.accountType === "isa" ? "Stocks ISA" : "Invest") && (
                    <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                      {connection.accountType === "isa" ? "Stocks ISA" : "Invest"}
                    </Typography>
                  )}
                </Box>
                <Typography sx={{ fontSize: 24, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {formatGbp(connection.valuation.total)}
                </Typography>
              </Stack>
              <TradingDisplaySelect
                value={connection.displayMode ?? "account"}
                disabled={disabled}
                onChange={(value) => display.mutate(value)}
              />
              <Box>
                <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", mb: 1 }}>
                  <Button
                    variant="outlined"
                    disabled={disabled}
                    onClick={() => action.mutate("refresh")}
                  >
                    Refresh values
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={disabled}
                    onClick={() => action.mutate(connection.history.error ? "resume" : "history")}
                  >
                    {connection.history.error ? "Retry history" : "Refresh history"}
                  </Button>
                </Stack>
                <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                  Valued {new Date(connection.valuation.fetchedAt).toLocaleString("en-GB")}
                </Typography>
                <Typography
                  color={connection.history.error ? "warning.main" : "text.secondary"}
                  sx={{ fontSize: 12, mt: 0.5 }}
                >
                  {connection.history.error ??
                    (connection.history.completedAt
                      ? "Cash history up to date"
                      : "Reading cash history…")}
                </Typography>
              </Box>
              <Box>
                <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, mb: 1 }}>
                  Holdings
                </Typography>
                {connection.valuation.positions.map((position) => (
                  <Stack
                    key={position.ticker}
                    direction="row"
                    sx={{
                      justifyContent: "space-between",
                      gap: 2,
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
                {connection.valuation.positions.length === 0 && (
                  <Typography color="text.secondary" sx={{ py: 1 }}>
                    No open positions.
                  </Typography>
                )}
                <Stack
                  direction="row"
                  sx={{
                    justifyContent: "space-between",
                    gap: 2,
                    py: 1.5,
                    borderTop: 1,
                    borderColor: "divider",
                  }}
                >
                  <Typography color="text.secondary">Uninvested cash</Typography>
                  <Typography sx={{ whiteSpace: "nowrap" }}>
                    {formatGbp(connection.valuation.cash)}
                  </Typography>
                </Stack>
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!confirmDisconnect && (
          <Button
            color="error"
            disabled={disabled}
            sx={{ mr: "auto" }}
            onClick={() => {
              action.reset();
              setConfirmDisconnect(true);
            }}
          >
            Disconnect
          </Button>
        )}
        <Button
          disabled={disabled}
          onClick={confirmDisconnect ? () => setConfirmDisconnect(false) : onClose}
        >
          {confirmDisconnect ? "Cancel" : "Close"}
        </Button>
        {confirmDisconnect && (
          <Button
            color="error"
            variant="contained"
            loading={disabled}
            onClick={() => action.mutate("disconnect")}
          >
            Disconnect
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function ConnectTradingDialog({ onClose }: { readonly onClose: () => void }) {
  const [name, setName] = useState(""),
    [accountType, setType] = useState<"invest" | "isa">("isa"),
    [displayMode, setDisplayMode] = useState<ConnectionDisplayMode>("account"),
    [apiKey, setKey] = useState(""),
    [apiSecret, setSecret] = useState("");
  const refresh = useRefresh();
  const connect = useMutation({
    mutationFn: () =>
      api.connections.connect.mutate({ name, accountType, apiKey, apiSecret, displayMode }),
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
            <TradingDisplaySelect
              value={displayMode}
              disabled={connect.isPending}
              onChange={setDisplayMode}
            />
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

function TradingDisplaySelect({
  value,
  disabled,
  onChange,
}: {
  readonly value: ConnectionDisplayMode;
  readonly disabled: boolean;
  readonly onChange: (value: ConnectionDisplayMode) => void;
}) {
  return (
    <TextField
      select
      fullWidth
      size="small"
      label="Table display"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as ConnectionDisplayMode)}
      helperText="Snapshot totals are unchanged. Uninvested cash stays within investments."
    >
      <MenuItem value="account">Whole account</MenuItem>
      <MenuItem value="holdings">Individual holdings and cash</MenuItem>
    </TextField>
  );
}
