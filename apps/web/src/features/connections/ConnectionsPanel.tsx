import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  SvgIcon,
  Typography,
} from "@mui/material";
import { formatGbp } from "@wealth/domain";
import { ConnectMonzoDialog, ManageMonzoDialog } from "./MonzoDialogs";
import { ConnectTradingDialog, ManageTradingDialog } from "./TradingDialogs";
import { bankRows, tradingRows, type ConnectionRow } from "./connectionRows";
import { moneyGroupTotal } from "../../components/table/groupTotals";
import { DataTable } from "../../components/table/DataTable";
import type { AppData } from "../../lib/data";

export function ConnectionsPanel({ data }: { readonly data: AppData }) {
  const [open, setOpen] = useState(false);
  const [connectAnchor, setConnectAnchor] = useState<HTMLElement | null>(null);
  const [rowMenu, setRowMenu] = useState<{ anchor: HTMLElement; row: ConnectionRow } | null>(null);
  const [tradingId, setTradingId] = useState<string | null>(null);
  const [monzoConnect, setMonzoConnect] = useState<string | null>(null);
  const [monzoId, setMonzoId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("monzo"),
  );
  const [callbackError, setCallbackError] = useState(() =>
    new URLSearchParams(window.location.search).has("monzoError"),
  );
  const bank = data.bankConnections.find((item) => item.id === monzoId);
  const trading = data.connections.find((item) => item.id === tradingId);
  const closeMonzo = () => {
    setMonzoId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("monzo");
    url.searchParams.delete("monzoError");
    window.history.replaceState(null, "", url);
  };
  const rows = [
    ...data.connections.flatMap(tradingRows),
    ...bankRows(data.bankConnections, data.accounts),
  ];
  return (
    <>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 3 }}>
        <Stack
          direction="row"
          sx={{
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 2,
            mb: 2,
          }}
        >
          <Typography component="h2" sx={{ fontWeight: 550, fontSize: 17 }}>
            Automated tracking accounts
          </Typography>
          <Button
            id="connect-account-button"
            variant="outlined"
            endIcon={
              <SvgIcon>
                <path
                  d="m7 10 5 5 5-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </SvgIcon>
            }
            aria-haspopup="menu"
            aria-controls={connectAnchor ? "connect-account-menu" : undefined}
            aria-expanded={!!connectAnchor}
            onClick={(event) => setConnectAnchor(event.currentTarget)}
          >
            Connect Account
          </Button>
        </Stack>
        {callbackError && (
          <Alert
            severity="error"
            onClose={() => {
              setCallbackError(false);
              closeMonzo();
            }}
            sx={{ mb: 2 }}
          >
            Monzo connection could not be completed. Check your confidential client and redirect
            URI, then connect again.
          </Alert>
        )}
        <DataTable
          id="connections"
          label="Automated tracking accounts"
          data={data}
          rows={rows}
          rowId={(row) => row.id}
          reorder
          columns={[
            {
              id: "name",
              label: "Account",
              value: (row) => row.name,
              render: (row) => (
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14 }}>{row.name}</Typography>
                  {row.detail && (
                    <Typography
                      color="text.secondary"
                      sx={{ fontSize: 12, maxWidth: 280, whiteSpace: "normal" }}
                    >
                      {row.detail}
                    </Typography>
                  )}
                </Box>
              ),
            },
            { id: "provider", label: "Provider", groupable: true, value: (row) => row.provider },
            { id: "type", label: "Type", groupable: true, value: (row) => row.type },
            {
              id: "value",
              label: "Value",
              align: "right",
              value: (row) => row.total,
              aggregate: (items) => {
                const balances = items.filter((row) => row.type !== "Connection");
                return balances.length ? moneyGroupTotal(balances, (row) => row.total) : "—";
              },
              render: (row) => (row.total === null ? "—" : formatGbp(row.total)),
            },
            {
              id: "valued",
              label: "Valued",
              value: (row) => row.fetchedAt,
              render: (row) =>
                row.fetchedAt ? new Date(row.fetchedAt).toLocaleString("en-GB") : "—",
            },
            {
              id: "history",
              label: "Cash history",
              value: (row) =>
                row.trading
                  ? (row.trading.history.error ??
                    (row.trading.history.completedAt ? "Up to date" : "Reading…"))
                  : "Not required",
              render: (row) => (
                <Typography
                  sx={{ fontSize: 12, maxWidth: 240, whiteSpace: "normal" }}
                  color={row.trading?.history.error ? "warning.main" : "text.secondary"}
                >
                  {row.trading
                    ? (row.trading.history.error ??
                      (row.trading.history.completedAt ? "Up to date" : "Reading…"))
                    : "Not required"}
                </Typography>
              ),
            },
            {
              id: "actions",
              label: "Actions",
              sortable: false,
              align: "right",
              value: () => "",
              render: (row) => (
                <IconButton
                  size="small"
                  aria-label={`Actions for ${row.name}${row.detail ? ` (${row.detail})` : ""}`}
                  aria-haspopup="menu"
                  aria-controls={rowMenu?.row.id === row.id ? "connection-actions-menu" : undefined}
                  aria-expanded={rowMenu?.row.id === row.id}
                  onClick={(event) => setRowMenu({ anchor: event.currentTarget, row })}
                >
                  <SvgIcon fontSize="small">
                    <circle cx="5" cy="12" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="19" cy="12" r="2" />
                  </SvgIcon>
                </IconButton>
              ),
            },
          ]}
        />
      </Paper>
      <Menu
        id="connect-account-menu"
        anchorEl={connectAnchor}
        open={!!connectAnchor}
        onClose={() => setConnectAnchor(null)}
        slotProps={{ list: { "aria-labelledby": "connect-account-button" } }}
      >
        <MenuItem
          onClick={() => {
            setConnectAnchor(null);
            setMonzoConnect("");
          }}
        >
          Connect Monzo
        </MenuItem>
        <MenuItem
          onClick={() => {
            setConnectAnchor(null);
            setOpen(true);
          }}
        >
          Connect Trading 212
        </MenuItem>
      </Menu>
      <Menu
        id="connection-actions-menu"
        anchorEl={rowMenu?.anchor ?? null}
        open={!!rowMenu}
        onClose={() => setRowMenu(null)}
      >
        <MenuItem
          onClick={() => {
            if (rowMenu?.row.trading) setTradingId(rowMenu.row.trading.id);
            else if (rowMenu?.row.bankId) setMonzoId(rowMenu.row.bankId);
            setRowMenu(null);
          }}
        >
          {rowMenu?.row.trading ? "Manage Trading 212" : "Manage Monzo"}
        </MenuItem>
      </Menu>
      {monzoConnect !== null && (
        <ConnectMonzoDialog
          {...(monzoConnect ? { connectionId: monzoConnect } : {})}
          onClose={() => setMonzoConnect(null)}
        />
      )}
      {bank && monzoConnect === null && (
        <ManageMonzoDialog
          key={bank.id}
          connection={bank}
          data={data}
          onClose={closeMonzo}
          onReconnect={() => {
            closeMonzo();
            setMonzoConnect(bank.id);
          }}
        />
      )}
      {trading && (
        <ManageTradingDialog
          key={trading.id}
          connection={trading}
          onClose={() => setTradingId(null)}
        />
      )}
      {open && <ConnectTradingDialog onClose={() => setOpen(false)} />}
    </>
  );
}
