import { accountAsset } from "@wealth/domain";
import { Box, MenuItem, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { BreakdownChart } from "../../components/charts/BreakdownChart";
import { ChartFrame, chartGrid } from "../../components/charts/ChartFrame";
import { colors, distinctCategoryColors } from "../../components/charts/chartData";
import type { AmountPoint } from "../../components/charts/chartData";
import type { AppData } from "../../lib/data";
export function AccountCharts({ data }: { readonly data: AppData }) {
  const [selected, setSelected] = useState("");
  const connection = data.connections.find((item) => item.id === selected) ?? data.connections[0];
  let missing = 0;
  const working: AmountPoint[] = data.accounts
    .filter((account) => !account.archived)
    .flatMap((account) => {
      const fallback = [...data.snapshots]
        .reverse()
        .flatMap((snapshot) => snapshot.balances)
        .find((row) => row.accountId === account.id)?.balance;
      const balance = account.workingBalance ?? fallback;
      if (balance === undefined) {
        missing++;
        return [];
      }
      return [
        {
          id: account.id,
          name: account.name + (account.workingBalance == null ? " (last recorded)" : ""),
          value: balance,
          color: colors[accountAsset(account.kind)],
        },
      ];
    });
  working.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const holdingColors = distinctCategoryColors(
    connection?.valuation.positions.map((position) => position.ticker) ?? [],
  );
  const holdings: AmountPoint[] = connection
    ? [
        ...connection.valuation.positions.map((position) => ({
          id: position.ticker,
          name: position.name + " (" + position.ticker + ")",
          value: position.value,
          color: holdingColors.get(position.ticker.toLowerCase())!,
        })),
        {
          id: "broker-cash",
          name: "Uninvested cash",
          value: connection.valuation.cash,
          color: colors.cash,
        },
      ]
    : [];
  // Preserve the account total without pretending an unallocated value is a known holding.
  if (connection) {
    const difference =
      connection.valuation.total - holdings.reduce((sum, row) => sum + row.value, 0);
    if (difference)
      holdings.push({
        id: "difference",
        name: "Other account value",
        value: difference,
        color: "#7e8795",
      });
  }
  return (
    <Box sx={chartGrid}>
      <ChartFrame title="Working balances" subtitle="Cash, debts and manually tracked assets">
        <BreakdownChart points={working} empty="Enter account balances to compare them here." />
        {missing > 0 && (
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>
            {missing} {missing === 1 ? "account has" : "accounts have"} no balance yet.
          </Typography>
        )}
      </ChartFrame>
      <ChartFrame
        title="Investment holdings"
        subtitle={
          connection
            ? "Valued " + new Date(connection.valuation.fetchedAt).toLocaleString("en-GB")
            : "Trading 212 account allocation"
        }
        action={
          data.connections.length > 1 ? (
            <TextField
              size="small"
              select
              label="Account"
              value={connection?.id ?? ""}
              onChange={(event) => setSelected(event.target.value)}
            >
              {data.connections.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.name}
                </MenuItem>
              ))}
            </TextField>
          ) : undefined
        }
      >
        <BreakdownChart
          kind="donut"
          points={holdings}
          empty={
            connection
              ? "No holdings or cash in this account."
              : "Connect Trading 212 to see holdings allocation."
          }
        />
      </ChartFrame>
    </Box>
  );
}
