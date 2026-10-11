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
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Icon } from "../../components/Icon";
import { backgroundApi } from "../../lib/api";
import { errorMessage } from "../../lib/data";
import { transactionsCsv, yearChunks, type TransactionRow } from "./transactionExport";

async function fetchTransactions(from: string, to: string) {
  const rows: TransactionRow[] = [];
  for (const range of yearChunks(from, to)) {
    let cursor: string | undefined;
    do {
      const page = await backgroundApi.analysis.transactions.query({
        ...range,
        ...(cursor ? { cursor } : {}),
      });
      rows.push(...page.rows);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  return rows;
}

function download(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

export function ExportTransactions({
  defaultFrom,
  defaultTo,
  today,
}: {
  readonly defaultFrom: string;
  readonly defaultTo: string;
  readonly today: string;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState({ from: defaultFrom, to: defaultTo });
  const valid = !!range.from && !!range.to && range.from <= range.to && range.to <= today;
  const exporter = useMutation({
    mutationFn: () => fetchTransactions(range.from, range.to),
    onSuccess: (rows) => {
      download(transactionsCsv(rows), `transactions-${range.from}-to-${range.to}.csv`);
      setOpen(false);
    },
  });
  const close = () => !exporter.isPending && setOpen(false);
  return (
    <>
      <Button
        variant="outlined"
        startIcon={<Icon name="down" />}
        onClick={() => {
          exporter.reset();
          setRange({ from: defaultFrom, to: defaultTo });
          setOpen(true);
        }}
      >
        Export CSV
      </Button>
      <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) exporter.mutate();
          }}
        >
          <DialogTitle>Export transactions</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {exporter.isError && <Alert severity="error">{errorMessage(exporter.error)}</Alert>}
              <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                Every transaction booked in this range, including excluded and sandbox ones.
              </Typography>
              <Stack direction="row" spacing={1.5}>
                <TextField
                  label="From"
                  type="date"
                  size="small"
                  fullWidth
                  required
                  value={range.from}
                  onChange={(event) => setRange({ ...range, from: event.target.value })}
                  slotProps={{
                    inputLabel: { shrink: true },
                    htmlInput: { max: range.to || today },
                  }}
                />
                <TextField
                  label="To"
                  type="date"
                  size="small"
                  fullWidth
                  required
                  value={range.to}
                  onChange={(event) => setRange({ ...range, to: event.target.value })}
                  slotProps={{
                    inputLabel: { shrink: true },
                    htmlInput: { min: range.from, max: today },
                  }}
                />
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={close} disabled={exporter.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={!valid}
              loading={exporter.isPending}
            >
              Download
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  );
}
