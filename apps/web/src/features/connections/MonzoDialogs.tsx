import { useState } from "react";
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
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { formatGbp, type PublicBankConnection } from "@wealth/domain";
import { api } from "../../lib/api";
import { errorMessage, useRefresh, type AppData } from "../../lib/data";

export function ConnectMonzoDialog({
  connectionId,
  onClose,
}: {
  readonly connectionId?: string;
  readonly onClose: () => void;
}) {
  const [clientId, setClientId] = useState(""),
    [clientSecret, setClientSecret] = useState("");
  const callback = `${window.location.origin}/auth/monzo/callback`;
  const connect = useMutation({
    mutationFn: () =>
      api.monzo.start.mutate({ clientId, clientSecret, ...(connectionId ? { connectionId } : {}) }),
    onSuccess: ({ url }) => {
      setClientSecret("");
      window.location.assign(url);
    },
  });
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={connect.isPending ? undefined : onClose}>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          connect.mutate();
        }}
      >
        <DialogTitle>{connectionId ? "Reconnect Monzo" : "Connect Monzo"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {connect.isError && <Alert severity="error">{errorMessage(connect.error)}</Alert>}
            <Typography color="text.secondary">
              Create a confidential OAuth client in{" "}
              <Link href="https://developers.monzo.com/" target="_blank" rel="noopener noreferrer">
                Monzo developer tools
              </Link>
              , using this redirect URI.
            </Typography>
            <TextField
              size="small"
              label="Redirect URI"
              value={callback}
              slotProps={{ input: { readOnly: true } }}
              fullWidth
            />
            <TextField
              size="small"
              label="Client ID"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              required
              autoComplete="off"
              slotProps={{ htmlInput: { maxLength: 512 } }}
            />
            <TextField
              size="small"
              label="Client secret"
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              required
              autoComplete="off"
              slotProps={{ htmlInput: { maxLength: 512 } }}
            />
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              Continue to Monzo, then approve access in its mobile app. Your client secret and
              access tokens are encrypted on the server.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={connect.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={connect.isPending}>
            Continue to Monzo
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export function ManageMonzoDialog({
  connection,
  data,
  onClose,
  onReconnect,
}: {
  readonly connection: PublicBankConnection;
  readonly data: AppData;
  readonly onClose: () => void;
  readonly onReconnect: () => void;
}) {
  const refresh = useRefresh();
  const [selection, setSelection] = useState<string[] | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const selected =
    selection ??
    data.accounts
      .filter((account) => !account.archived && account.automation?.connectionId === connection.id)
      .map((account) => account.automation!.externalId);
  const action = useMutation({
    mutationFn: async (kind: "refresh" | "select" | "disconnect") => {
      if (kind === "refresh") return api.monzo.refresh.mutate({ id: connection.id });
      if (kind === "select")
        return api.monzo.select.mutate({
          id: connection.id,
          externalIds: selected,
          expectedVersion: connection.version,
        });
      return api.monzo.disconnect.mutate({
        id: connection.id,
        expectedVersion: connection.version,
      });
    },
    onSuccess: async (_, kind) => {
      await refresh();
      if (kind !== "refresh") onClose();
      else setSelection(null);
    },
    onError: () => {
      void refresh();
    },
  });
  const disabled = action.isPending;
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={disabled ? undefined : onClose}>
      <DialogTitle>
        {confirmDisconnect ? "Disconnect Monzo?" : "Monzo accounts and pots"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {action.isError && <Alert severity="error">{errorMessage(action.error)}</Alert>}
          {!action.isError && connection.error && (
            <Alert severity="warning">{connection.error}</Alert>
          )}
          {confirmDisconnect ? (
            <Typography>
              Tracked accounts will become manual accounts with their last fetched balances. Saved
              history and budget destinations will remain. Stored Monzo credentials will be removed.
            </Typography>
          ) : (
            <>
              {connection.status === "awaiting-approval" && (
                <Alert severity="info">
                  Approve access in the Monzo app, then load your balances.
                </Alert>
              )}
              {connection.status === "reconnect" ? (
                <Button onClick={onReconnect}>Reconnect Monzo</Button>
              ) : (
                <Button
                  sx={{ alignSelf: "flex-start" }}
                  disabled={disabled}
                  onClick={() => action.mutate("refresh")}
                >
                  {connection.valuation ? "Refresh balances" : "Load balances"}
                </Button>
              )}
              {connection.valuation && (
                <>
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                    Choose the balances to track. Archive any matching manual accounts to avoid
                    counting them twice.
                  </Typography>
                  <Box sx={{ borderTop: 1, borderColor: "divider" }}>
                    {connection.valuation.balances.map((balance) => (
                      <Stack
                        key={balance.id}
                        direction="row"
                        sx={{
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 2,
                          borderBottom: 1,
                          borderColor: "divider",
                          py: 0.75,
                        }}
                      >
                        <FormControlLabel
                          sx={{ minWidth: 0, mr: 0 }}
                          control={
                            <Checkbox
                              checked={selected.includes(balance.id)}
                              disabled={disabled || connection.status !== "ready"}
                              onChange={(_, checked) =>
                                setSelection(
                                  checked
                                    ? [...selected, balance.id]
                                    : selected.filter((id) => id !== balance.id),
                                )
                              }
                            />
                          }
                          label={
                            <Box>
                              <Typography sx={{ fontSize: 14, overflowWrap: "anywhere" }}>
                                {balance.name}
                              </Typography>
                              <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                                {balance.kind === "debt"
                                  ? "Debt"
                                  : balance.type === "pot"
                                    ? "Pot"
                                    : "Current account"}
                              </Typography>
                            </Box>
                          }
                        />
                        <Typography
                          sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
                        >
                          {formatGbp(balance.balance)}
                        </Typography>
                      </Stack>
                    ))}
                  </Box>
                  {connection.valuation.balances.length === 0 && (
                    <Typography>No supported accounts or pots were returned by Monzo.</Typography>
                  )}
                  <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                    Updated {new Date(connection.valuation.fetchedAt).toLocaleString("en-GB")}.
                    Products not listed here can stay manually tracked.
                  </Typography>
                </>
              )}
              <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                <Button disabled={disabled} onClick={onReconnect}>
                  Change credentials
                </Button>
                <Button
                  color="error"
                  disabled={disabled}
                  onClick={() => {
                    action.reset();
                    setConfirmDisconnect(true);
                  }}
                >
                  Disconnect
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          disabled={disabled}
          onClick={confirmDisconnect ? () => setConfirmDisconnect(false) : onClose}
        >
          {confirmDisconnect ? "Cancel" : "Close"}
        </Button>
        <Button
          variant="contained"
          color={confirmDisconnect ? "error" : "primary"}
          loading={disabled}
          disabled={!confirmDisconnect && connection.status !== "ready"}
          onClick={() => action.mutate(confirmDisconnect ? "disconnect" : "select")}
        >
          {confirmDisconnect ? "Disconnect" : "Save selection"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
