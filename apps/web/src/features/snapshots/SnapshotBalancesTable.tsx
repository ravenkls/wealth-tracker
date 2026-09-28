import { useMemo, useState } from "react";
import {
  Box,
  Button,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import {
  useTable,
  tableFeatures,
  columnGroupingFeature,
  rowExpandingFeature,
  createGroupedRowModel,
  createExpandedRowModel,
} from "@tanstack/react-table";
import type { ExpandedState } from "@tanstack/react-table";
import { accountKindLabels, formatGbp, formatMonth, parseGbp } from "@wealth/domain";
import type { ManualAccountKind, Month, Pence, TablePreferences } from "@wealth/domain";
import { Icon } from "../../components/Icon";
import { moneyGroupTotal } from "../../components/table/groupTotals";

interface AccountRow {
  id: string;
  name: string;
  kind: ManualAccountKind;
  archived?: boolean;
}
const features = tableFeatures({
  columnGroupingFeature,
  rowExpandingFeature,
  groupedRowModel: createGroupedRowModel(),
  expandedRowModel: createExpandedRowModel(),
});
const columns = [
  { id: "name", accessorFn: (row: AccountRow) => row.name },
  { id: "kind", accessorFn: (row: AccountRow) => accountKindLabels[row.kind] },
  { id: "status", accessorFn: (row: AccountRow) => (row.archived ? "Archived" : "Active") },
];

export function SnapshotBalancesTable({
  rows,
  balances,
  onChange,
  preferences,
  previousBalance,
  disabled,
  density = "standard",
}: {
  readonly rows: AccountRow[];
  readonly balances: Record<string, string>;
  readonly onChange: (id: string, value: string) => void;
  readonly preferences: TablePreferences | undefined;
  readonly previousBalance: (id: string) => { value: Pence; month: Month } | undefined;
  readonly disabled: boolean;
  readonly density?: "standard" | "compact";
}) {
  const compact = density === "compact";
  const grouping = (preferences?.grouping ?? ["kind"]).filter(
    (key) => key === "kind" || key === "status",
  );
  const groupingKey = JSON.stringify(grouping);
  const [expansion, setExpansion] = useState<{ key: string; value: ExpandedState }>({
    key: groupingKey,
    value: true,
  });
  if (expansion.key !== groupingKey) setExpansion({ key: groupingKey, value: true });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const ordered = useMemo(() => {
    const ranks = new Map(preferences?.rowOrder.map((id, index) => [id, index]));
    return [...rows].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
  }, [rows, preferences?.rowOrder]);
  const table = useTable({
    features,
    data: ordered,
    columns,
    getRowId: (row) => row.id,
    state: { grouping, expanded: expansion.value },
    onExpandedChange: (next) =>
      setExpansion((current) => ({
        key: groupingKey,
        value: typeof next === "function" ? next(current.value) : next,
      })),
    autoResetExpanded: false,
  });
  function amount(id: string) {
    try {
      return parseGbp(balances[id] ?? "");
    } catch {
      return null;
    }
  }
  return (
    <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
      <Table
        size="small"
        aria-label="Snapshot account balances"
        sx={{
          tableLayout: "fixed",
          "& td, & th": { px: { xs: 1, sm: 1.5 }, py: compact ? 0.375 : 1 },
          "& th": { bgcolor: "var(--app-inset)", fontSize: 12 },
          "& tbody tr:last-child td": { borderBottom: 0 },
        }}
      >
        <TableHead>
          <TableRow>
            <TableCell>Account</TableCell>
            <TableCell align="right" sx={{ width: { xs: 132, sm: 164 } }}>
              Balance
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {table.getRowModel().rows.map((row) => {
            if (row.getIsGrouped())
              return (
                <TableRow key={row.id} sx={{ bgcolor: "action.hover" }}>
                  <TableCell>
                    <Button
                      type="button"
                      size="small"
                      onClick={row.getToggleExpandedHandler()}
                      aria-expanded={row.getIsExpanded()}
                      sx={{
                        minWidth: 0,
                        minHeight: compact ? 28 : 40,
                        textAlign: "left",
                        gap: 0.75,
                        px: 0.5,
                        py: compact ? 0 : 0.5,
                      }}
                    >
                      <Box
                        component="span"
                        sx={{
                          display: "flex",
                          transform: row.getIsExpanded() ? "rotate(90deg)" : undefined,
                        }}
                      >
                        <Icon name="chevron" size={14} />
                      </Box>
                      {String(row.getValue(row.groupingColumnId!) ?? "Unassigned")} (
                      {row.getLeafRows().length})
                    </Button>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    {moneyGroupTotal(row.getLeafRows(), (leaf) => amount(leaf.original.id))}
                  </TableCell>
                </TableRow>
              );
            const account = row.original;
            const previous = previousBalance(account.id);
            const invalid = touched[account.id] && amount(account.id) === null;
            return (
              <TableRow key={row.id} sx={{ "&:focus-within": { bgcolor: "action.hover" } }}>
                <TableCell>
                  <Typography sx={{ fontSize: 13, overflowWrap: "anywhere" }}>
                    {account.name}
                  </Typography>
                  {previous && (
                    <Typography
                      color="text.secondary"
                      sx={{ fontSize: 11, mt: compact ? 0.25 : 0.5 }}
                    >
                      Last recorded {formatMonth(previous.month)}: {formatGbp(previous.value)}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  <TextField
                    value={balances[account.id] ?? ""}
                    onChange={(event) => onChange(account.id, event.target.value)}
                    onBlur={() => setTouched((current) => ({ ...current, [account.id]: true }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.querySelector("input")?.blur();
                      }
                    }}
                    disabled={disabled}
                    required
                    variant="standard"
                    size="small"
                    fullWidth
                    error={!!invalid}
                    helperText={
                      invalid ? "Enter a GBP amount with up to two decimal places." : undefined
                    }
                    slotProps={{
                      htmlInput: { "aria-label": account.name + " balance", inputMode: "decimal" },
                      input: {
                        disableUnderline: true,
                        startAdornment: <InputAdornment position="start">£</InputAdornment>,
                      },
                    }}
                    sx={{
                      "& .MuiInputBase-root": { fontSize: 13, px: 0.75 },
                      "& input": { textAlign: "right", py: compact ? 0.5 : 1 },
                      "& .MuiInputAdornment-root p": { fontSize: 13 },
                      "&:focus-within": {
                        outline: "1px solid",
                        outlineColor: "primary.main",
                        borderRadius: 0.5,
                      },
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  />
                </TableCell>
              </TableRow>
            );
          })}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={2} sx={{ color: "text.secondary" }}>
                No manually tracked accounts.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
