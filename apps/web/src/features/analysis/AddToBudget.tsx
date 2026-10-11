import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { canonicalCategory, formatGbp, monthlyBudgets, parseGbp, pence } from "@wealth/domain";
import { MoneyField, moneyInput, readMoney } from "../../components/Fields";
import { api } from "../../lib/api";
import { errorMessage, useAppData } from "../../lib/data";
import { useCategories } from "./CategoriesPanel";
import { recentMonthlyAverage, type Analysis } from "./ledgerModel";

const spans = [3, 6, 12] as const;

export function AddToBudget({
  analysis,
  category,
}: {
  readonly analysis: Analysis;
  readonly category: Analysis["categories"][number];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
        Add to budget
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        {open && (
          <AddToBudgetForm analysis={analysis} category={category} onClose={() => setOpen(false)} />
        )}
      </Dialog>
    </>
  );
}

function AddToBudgetForm({
  analysis,
  category,
  onClose,
}: {
  readonly analysis: Analysis;
  readonly category: Analysis["categories"][number];
  readonly onClose: () => void;
}) {
  const client = useQueryClient();
  const wealth = useAppData();
  const categories = useCategories();
  const budget = wealth.data?.budget ?? null;
  const names = budget ? [...monthlyBudgets(budget.plan).keys()] : [];
  const [span, setSpan] = useState<(typeof spans)[number]>(3);
  const suggestion = (months: number) =>
    moneyInput(Math.round(recentMonthlyAverage(analysis, category, months).average));
  const [amount, setAmount] = useState(() => suggestion(span));
  const [mode, setMode] = useState<"existing" | "new">(names.length ? "existing" : "new");
  const [existing, setExisting] = useState(names[0] ?? "");
  const [created, setCreated] = useState(category.name);
  const target = mode === "existing" ? existing : created.trim();
  const { months } = recentMonthlyAverage(analysis, category, span);
  // Linking to an existing category needs no new expense unless it adds to that budget.
  const adds = (value: number) => mode === "new" || value > 0;
  const parsed = (() => {
    try {
      return parseGbp(amount);
    } catch {
      return null;
    }
  })();
  const save = useMutation({
    mutationFn: async () => {
      const value = readMoney(amount, "Monthly amount");
      const name = canonicalCategory(target, names);
      if (!budget) throw new Error("Set up your budget first.");
      if (!target) throw new Error("Name the budget category.");
      const status = categories.data!;
      // Link first: a link to a budget category that doesn't exist yet is ignored, so retrying is safe.
      await api.categories.save.mutate({
        categories: status.categories.map((item) =>
          item.id === category.id ? { ...item, budgetCategory: name } : item,
        ),
        expectedVersion: status.version,
      });
      if (adds(value))
        await api.budget.save.mutate({
          plan: {
            ...budget.plan,
            expenses: [
              ...budget.plan.expenses,
              {
                id: crypto.randomUUID(),
                name: category.name,
                category: name,
                amount: value,
                frequency: "monthly",
                destinationId: null,
              },
            ],
          },
          expectedVersion: budget.version,
        });
    },
    onSuccess: async () => {
      await Promise.all(
        ["wealth", "purchase-categories"].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
      onClose();
    },
  });
  return (
    <>
      <DialogTitle sx={{ pb: 1 }}>Add {category.name} to your budget</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2.5, pt: 0.5 }}>
          <Stack sx={{ gap: 1 }}>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Suggest from</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={span}
              aria-label="Suggest from"
              onChange={(_, value: (typeof spans)[number] | null) => {
                if (!value) return;
                setSpan(value);
                setAmount(suggestion(value));
              }}
            >
              {spans.map((value) => (
                <ToggleButton key={value} value={value}>
                  Last {value} months
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <MoneyField
              label="Monthly amount"
              value={amount}
              onChange={setAmount}
              helperText={
                months
                  ? `Average of ${months} ${months === 1 ? "month" : "months"} with data${months < span ? `, all that's available` : ""}.`
                  : "No finished months with data yet."
              }
            />
          </Stack>
          <RadioGroup
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
            aria-label="Budget category"
          >
            <FormControlLabel
              value="existing"
              control={<Radio size="small" />}
              label="Add to an existing budget category"
              disabled={!names.length}
            />
            {mode === "existing" && (
              <TextField
                select
                size="small"
                label="Budget category"
                value={existing}
                onChange={(event) => setExisting(event.target.value)}
                sx={{ ml: 4, mb: 1 }}
              >
                {names.map((name) => (
                  <MenuItem key={name} value={name}>
                    {name} · {formatGbp(pence(monthlyBudgets(budget!.plan).get(name)!))}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <FormControlLabel
              value="new"
              control={<Radio size="small" />}
              label="Create a new budget category"
            />
            {mode === "new" && (
              <TextField
                size="small"
                label="Category name"
                value={created}
                onChange={(event) => setCreated(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 80 } }}
                sx={{ ml: 4 }}
              />
            )}
          </RadioGroup>
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>
            Links {category.name} to {target || "the budget category"}
            {parsed !== null && adds(parsed)
              ? ` and adds a ${formatGbp(parsed)} monthly ${category.name} expense to your budget.`
              : "."}
          </Typography>
          {save.error && <Alert severity="error">{errorMessage(save.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={save.isPending || !budget || !categories.data}
          onClick={() => save.mutate()}
        >
          Add to budget
        </Button>
      </DialogActions>
    </>
  );
}
