import { BudgetCharts } from "./BudgetCharts";
import { CategoryCell } from "../../components/table/CategoryCell";
import { canonicalCategory, normalizeBudgetCategories, isCashAccount } from "@wealth/domain";
import { budgetGroupTotal } from "../../components/table/groupTotals";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DataTable } from "../../components/table/DataTable";
import { EditableCell } from "../../components/table/EditableCell";
import { AutosaveQueue } from "../../lib/autosave";
import { Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { calculateBudget, formatGbp, month, payFrequencies } from "@wealth/domain";
import type { BudgetLine, BudgetPlan, PayFrequency } from "@wealth/domain";
import { MoneyField, moneyInput, readMoney } from "../../components/Fields";
import { PageHeading } from "../../components/PageHeading";
import { api } from "../../lib/api";
import { errorMessage, useRefresh } from "../../lib/data";
import type { AppData } from "../../lib/data";
const frequencyLabels: Record<PayFrequency, string> = {
  monthly: "Monthly",
  "twice-monthly": "Twice monthly",
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  "four-weekly": "Every four weeks",
};
type DraftLine = Omit<BudgetLine, "amount"> & { amount: string };
const draftLines = (lines: BudgetLine[] | undefined) =>
  lines?.map((line) => ({ ...line, amount: moneyInput(line.amount) })) ?? [];
function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Box sx={{ mb: 4, pb: 4, borderBottom: 1, borderColor: "divider" }}>
      <Typography component="h2" sx={{ fontSize: 17, fontWeight: 550, mb: 2.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
export function BudgetPage({ data }: { readonly data: AppData }) {
  const plan = data.budget?.plan;
  const [salary, setSalary] = useState(moneyInput(plan?.salary ?? 0)),
    [frequency, setFrequency] = useState<PayFrequency>(plan?.payFrequency ?? "monthly"),
    [sideIncome, setSideIncome] = useState(moneyInput(plan?.sideIncome ?? 0));
  const [expenses, setExpenses] = useState(() => draftLines(plan?.expenses)),
    [allocations, setAllocations] = useState(() => draftLines(plan?.savingsAllocations));
  const [settings, setSettings] = useState({
    emergencyMonths: plan?.emergencyMonths?.toString() ?? "",
    targetCashShare:
      plan?.targetCashShare === null || plan?.targetCashShare === undefined
        ? ""
        : String(plan.targetCashShare * 100),
    aggressiveness: plan?.aggressiveness ?? 1,
    cashDestinationId: plan?.cashDestinationId ?? "",
    investmentDestinationId: plan?.investmentDestinationId ?? "",
    cashGoal: moneyInput(plan?.cashGoal),
    endOfYearGoal: moneyInput(plan?.endOfYearGoal),
    depositGoal: moneyInput(plan?.depositGoal),
    depositInvestmentFraction:
      plan?.depositInvestmentFraction === null || plan?.depositInvestmentFraction === undefined
        ? ""
        : String(plan.depositInvestmentFraction * 100),
    depositSavingsFraction:
      plan?.depositSavingsFraction === null || plan?.depositSavingsFraction === undefined
        ? ""
        : String(plan.depositSavingsFraction * 100),
    jobStartMonth: plan?.jobStartMonth ?? "",
  });
  const [status, setStatus] = useState<"saving" | "saved" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const [validationError, setValidationError] = useState("");
  const refresh = useRefresh();
  const cashAccounts = data.accounts.filter(
    (account) => !account.archived && isCashAccount(account.kind),
  );
  const destinations = [
    ...cashAccounts,
    ...data.accounts.filter((account) => !account.archived && account.kind === "investment"),
    ...data.connections,
  ];
  const categories: string[] = [];
  for (const line of [...expenses, ...allocations]) {
    const category = canonicalCategory(line.category, categories);
    if (category && !categories.includes(category)) categories.push(category);
  }
  categories.sort((a, b) => a.localeCompare(b));

  const change = (key: Exclude<keyof typeof settings, "aggressiveness">, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };
  function numberOrNull(value: string, label: string, divisor = 1) {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || (divisor === 100 && parsed > 100))
      throw new Error(
        `${label}: enter ${divisor === 100 ? "a percentage from 0 to 100" : "a positive number"}.`,
      );
    return parsed / divisor;
  }
  function positiveMoney(value: string, label: string) {
    const parsed = readMoney(value, label);
    if (parsed < 0) throw new Error(label + ": enter zero or a positive amount.");
    return parsed;
  }
  function goalMoney(value: string, label: string) {
    return value.trim() ? positiveMoney(value, label) : null;
  }
  function readPlan(): BudgetPlan {
    return {
      salary: positiveMoney(salary, "Take-home pay"),
      payFrequency: frequency,
      sideIncome: positiveMoney(sideIncome, "Side income"),
      expenses: expenses.map((line) => ({
        ...line,
        amount: positiveMoney(line.amount, line.name || "Expense"),
      })),
      savingsAllocations: allocations.map((line) => ({
        ...line,
        amount: positiveMoney(line.amount, line.name || "Saving"),
      })),
      emergencyMonths: numberOrNull(settings.emergencyMonths, "Emergency months"),
      targetCashShare: numberOrNull(settings.targetCashShare, "Cash share", 100),
      aggressiveness: settings.aggressiveness,
      cashDestinationId: settings.cashDestinationId || null,
      investmentDestinationId: settings.investmentDestinationId || null,
      cashGoal: goalMoney(settings.cashGoal, "Cash goal"),
      endOfYearGoal: goalMoney(settings.endOfYearGoal, "Year-end goal"),
      depositGoal: goalMoney(settings.depositGoal, "Deposit goal"),
      depositInvestmentFraction: numberOrNull(
        settings.depositInvestmentFraction,
        "Eligible investments",
        100,
      ),
      depositSavingsFraction: numberOrNull(
        settings.depositSavingsFraction,
        "Deposit saving share",
        100,
      ),
      jobStartMonth: settings.jobStartMonth ? month(settings.jobStartMonth) : null,
    };
  }
  const signature = JSON.stringify({
    salary,
    frequency,
    sideIncome,
    expenses,
    allocations,
    settings,
  });
  const latestSignature = useRef(signature);
  latestSignature.current = signature;
  const submittedSignature = useRef(signature);
  const initialSignature = useRef(signature);
  const queue = useRef<AutosaveQueue<BudgetPlan> | null>(null);
  if (!queue.current)
    queue.current = new AutosaveQueue(
      data.budget?.version ?? 0,
      readPlan(),
      async (next, version) => {
        const result = await api.budget.save.mutate({ plan: next, expectedVersion: version });
        void refresh();
        return result.version;
      },
      (next, cause) => {
        if (next !== "saved" || latestSignature.current === submittedSignature.current)
          setStatus(next);
        if (cause) setSaveError(errorMessage(cause));
      },
    );
  const readLatest = useRef(readPlan);
  readLatest.current = readPlan;
  useEffect(() => {
    if (signature === initialSignature.current) return;
    initialSignature.current = "";
    if (status === "error") return;
    setStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        const next = readLatest.current();
        if ([...next.expenses, ...next.savingsAllocations].some((line) => !line.name.trim()))
          throw new Error("Enter a name for each budget item.");
        setValidationError("");
        submittedSignature.current = signature;
        queue.current!.enqueue(next);
      } catch (cause) {
        setValidationError(errorMessage(cause));
        setStatus("saved");
      }
    }, 600);
    return () => window.clearTimeout(timer);
    // Status changes must not schedule additional writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useEffect(() => {
    if (status !== "saving" && !validationError && !saveError) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const guard = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", guard, true);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guard, true);
    };
  }, [status, validationError, saveError]);
  useEffect(
    () => () => {
      try {
        const next = readLatest.current();
        if ([...next.expenses, ...next.savingsAllocations].every((line) => line.name.trim()))
          queue.current?.enqueue(next);
      } catch {
        /* Invalid drafts are never persisted. */
      }
    },
    [],
  );
  let chartPlan: BudgetPlan | null = null;
  let summary: ReturnType<typeof calculateBudget> | null = null;
  try {
    chartPlan = normalizeBudgetCategories(readPlan());
    summary = calculateBudget(chartPlan, data.snapshots.at(-1) ?? null);
  } catch {
    /* Partial form values have no preview. */
  }
  const selectDestination = (
    label: string,
    key: "cashDestinationId" | "investmentDestinationId",
    options: typeof destinations,
  ) => (
    <TextField
      select
      size="small"
      label={label}
      value={settings[key]}
      onChange={(event) => change(key, event.target.value)}
      fullWidth
    >
      <MenuItem value="">Unassigned</MenuItem>
      {settings[key] && !options.some((account) => account.id === settings[key]) && (
        <MenuItem value={settings[key]} disabled>
          Unavailable account — choose another
        </MenuItem>
      )}
      {options.map((account) => (
        <MenuItem key={account.id} value={account.id}>
          {account.name}
        </MenuItem>
      ))}
    </TextField>
  );
  return (
    <Box>
      <PageHeading title="Budget">
        {status === "saving" && (
          <Typography component="output" color="text.secondary" sx={{ fontSize: 12 }}>
            Saving…
          </Typography>
        )}
      </PageHeading>
      {saveError && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          {saveError} Your changes have not been confirmed saved.
        </Alert>
      )}
      {validationError && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {validationError} Changes are not saved.
        </Alert>
      )}
      {chartPlan && (
        <BudgetCharts
          plan={chartPlan}
          latest={data.snapshots.at(-1) ?? null}
          destinations={destinations}
        />
      )}
      <Box
        component="fieldset"
        disabled={status === "error"}
        sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", xl: "minmax(0,1fr) 300px" },
            gap: 4,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Section title="Income">
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2.5}>
                <MoneyField
                  label="Take-home pay per payday"
                  value={salary}
                  onChange={setSalary}
                  required
                />
                <TextField
                  select
                  size="small"
                  fullWidth
                  label="Pay frequency"
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as PayFrequency)}
                >
                  {payFrequencies.map((value) => (
                    <MenuItem value={value} key={value}>
                      {frequencyLabels[value]}
                    </MenuItem>
                  ))}
                </TextField>
                <MoneyField
                  label="Monthly side income"
                  value={sideIncome}
                  onChange={setSideIncome}
                  required
                />
              </Stack>
            </Section>
            <Section title="Expenses">
              <LineEditor
                data={data}
                categories={categories}
                tableId="expenses"
                lines={expenses}
                onChange={setExpenses}
                accounts={cashAccounts}
                addLabel="Add expense"
              />
            </Section>
            <Section title="Planned savings">
              <LineEditor
                data={data}
                categories={categories}
                tableId="allocations"
                lines={allocations}
                onChange={setAllocations}
                accounts={cashAccounts}
                addLabel="Add saving allocation"
              />
            </Section>
            <Section title="Cash & investment split">
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                  gap: 2.5,
                }}
              >
                <TextField
                  size="small"
                  type="number"
                  label="Emergency cover (months)"
                  value={settings.emergencyMonths}
                  onChange={(event) => change("emergencyMonths", event.target.value)}
                  slotProps={{ htmlInput: { min: 0, max: 120, step: "any" } }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Target cash share (%)"
                  value={settings.targetCashShare}
                  onChange={(event) => change("targetCashShare", event.target.value)}
                  slotProps={{ htmlInput: { min: 0, max: 100, step: "any" } }}
                />
                <TextField
                  select
                  size="small"
                  label="Rebalancing strength"
                  value={settings.aggressiveness}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      aggressiveness: Number(event.target.value) as 1 | 2 | 3,
                    }))
                  }
                >
                  {[1, 2, 3].map((value) => (
                    <MenuItem value={value} key={value}>
                      {value === 1 ? "1: Low" : value === 2 ? "2: Medium" : "3: High"}
                    </MenuItem>
                  ))}
                </TextField>
                {selectDestination("Cash saving destination", "cashDestinationId", cashAccounts)}
                {selectDestination(
                  "Investment funding destination",
                  "investmentDestinationId",
                  destinations,
                )}
              </Box>
              <Typography color="text.secondary" sx={{ fontSize: 12, mt: 2 }}>
                Below the emergency target, all surplus goes to cash. Above it, the split adjusts to
                your latest cash and investment balances.
              </Typography>
            </Section>
            <Section title="Savings goals">
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                  gap: 2.5,
                }}
              >
                <MoneyField
                  label="Cash savings goal"
                  value={settings.cashGoal}
                  onChange={(value) => change("cashGoal", value)}
                />
                <MoneyField
                  label="Year-end cash goal"
                  value={settings.endOfYearGoal}
                  onChange={(value) => change("endOfYearGoal", value)}
                />
                <MoneyField
                  label="House deposit goal"
                  value={settings.depositGoal}
                  onChange={(value) => change("depositGoal", value)}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Investments toward deposit (%)"
                  value={settings.depositInvestmentFraction}
                  onChange={(event) => change("depositInvestmentFraction", event.target.value)}
                  slotProps={{ htmlInput: { min: 0, max: 100, step: "any" } }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Savings directed to deposit (%)"
                  value={settings.depositSavingsFraction}
                  onChange={(event) => change("depositSavingsFraction", event.target.value)}
                  slotProps={{ htmlInput: { min: 0, max: 100, step: "any" } }}
                />
                <TextField
                  size="small"
                  type="month"
                  label="Projection start month (optional)"
                  value={settings.jobStartMonth}
                  onChange={(event) => change("jobStartMonth", event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Box>
            </Section>
          </Box>
          <Box>
            <Paper
              variant="outlined"
              sx={{
                p: 3,
                position: { xl: "sticky" },
                top: 24,
                maxHeight: { xl: "calc(100dvh - 48px)" },
                overflowY: { xl: "auto" },
              }}
            >
              <Typography component="h2" sx={{ fontSize: 17, mb: 2 }}>
                Monthly plan
              </Typography>
              {summary ? (
                <>
                  {(
                    [
                      ["Income", summary.income],
                      ["Expenses", summary.spending],
                      ["Planned savings", summary.explicitSavings],
                      ["Remaining surplus", summary.surplus],
                      ["Emergency target", summary.emergency],
                      ["Surplus to cash", summary.cashAllocation],
                      ["Surplus to investments", summary.investmentAllocation],
                      ["Unallocated rounding", summary.remainder],
                    ] as const
                  ).map(([label, value]) => (
                    <Box
                      key={label}
                      sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 1 }}
                    >
                      <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                        {label}
                      </Typography>
                      <Typography
                        sx={{ fontSize: 13, whiteSpace: "nowrap", flexShrink: 0 }}
                        color={value !== null && value < 0 ? "error.main" : "text.primary"}
                      >
                        {value === null ? "—" : formatGbp(value)}
                      </Typography>
                    </Box>
                  ))}
                  <Typography sx={{ fontSize: 13, mt: 2 }}>
                    Planned savings rate:{" "}
                    {summary.plannedSavingsRate === null
                      ? "—"
                      : `${(summary.plannedSavingsRate * 100).toFixed(1)}%`}
                  </Typography>
                  {summary.surplus < 0 && (
                    <Alert severity="warning" sx={{ mt: 2 }}>
                      The plan exceeds your income.
                    </Alert>
                  )}
                  {summary.cashAllocation === null && summary.surplus >= 0 && (
                    <Typography color="text.secondary" sx={{ fontSize: 12, mt: 2 }}>
                      Set the cash target and emergency months, and record a snapshot to calculate
                      the split.
                    </Typography>
                  )}
                  <Typography component="h3" sx={{ fontSize: 15, mt: 3, mb: 1 }}>
                    Funding per payday
                  </Typography>
                  {summary.funding.length === 0 ? (
                    <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                      Choose destination accounts in the plan.
                    </Typography>
                  ) : (
                    summary.funding.map((funding) => (
                      <Box
                        key={funding.destinationId}
                        sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 1 }}
                      >
                        <Typography sx={{ fontSize: 13 }}>
                          {destinations.find((account) => account.id === funding.destinationId)
                            ?.name ?? "Unavailable account"}
                        </Typography>
                        <Typography sx={{ fontSize: 13, whiteSpace: "nowrap", flexShrink: 0 }}>
                          {formatGbp(funding.perPayPeriod)}
                        </Typography>
                      </Box>
                    ))
                  )}
                </>
              ) : (
                <Typography color="text.secondary">
                  Enter valid amounts to see your plan.
                </Typography>
              )}
            </Paper>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
function LineEditor({
  lines,
  onChange,
  accounts,
  addLabel,
  data,
  tableId,
  categories,
}: {
  readonly categories: string[];
  readonly lines: DraftLine[];
  readonly onChange: (lines: DraftLine[]) => void;
  readonly accounts: { id: string; name: string }[];
  readonly addLabel: string;
  readonly data: AppData;
  readonly tableId: "expenses" | "allocations";
}) {
  const update = (id: string, patch: Partial<DraftLine>) =>
    onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  return (
    <Stack spacing={2}>
      <DataTable
        id={tableId}
        defaultGrouping={["category"]}
        label={tableId === "expenses" ? "Expenses" : "Planned savings"}
        data={data}
        rows={lines}
        rowId={(line) => line.id}
        reorder
        columns={[
          {
            id: "name",
            label: "Name",
            minWidth: 220,
            value: (line) => line.name,
            render: (line) => (
              <EditableCell
                label={line.name + " name"}
                value={line.name}
                onCommit={(name) => {
                  if (!name.trim()) throw new Error("Enter a name.");
                  update(line.id, { name });
                }}
              />
            ),
          },
          {
            id: "amount",
            aggregate: budgetGroupTotal,
            label: "Amount",
            align: "right",
            value: (line) => Number(line.amount),
            render: (line) => (
              <EditableCell
                numeric
                label={line.name + " amount"}
                value={line.amount}
                onCommit={(amount) => {
                  if (readMoney(amount, line.name) < 0) throw new Error("Enter a positive amount.");
                  update(line.id, { amount });
                }}
              />
            ),
          },
          {
            id: "category",
            label: "Category",
            groupable: true,
            value: (line) => canonicalCategory(line.category, categories) ?? "Uncategorised",
            render: (line) => (
              <CategoryCell
                value={line.category ?? null}
                label={line.name + " category"}
                options={categories}
                onCommit={(category) => update(line.id, { category })}
              />
            ),
          },
          {
            id: "frequency",
            label: "Frequency",
            groupable: true,
            value: (line) => line.frequency,
            render: (line) => (
              <EditableCell
                label={line.name + " frequency"}
                value={line.frequency}
                options={[
                  { value: "monthly", label: "Monthly" },
                  { value: "annual", label: "Annual" },
                ]}
                onCommit={(frequency) =>
                  update(line.id, { frequency: frequency as "monthly" | "annual" })
                }
              />
            ),
          },
          {
            id: "destination",
            label: "Destination",
            minWidth: 230,
            groupable: true,
            value: (line) =>
              accounts.find((account) => account.id === line.destinationId)?.name ?? "Unassigned",
            render: (line) => (
              <EditableCell
                label={line.name + " destination"}
                value={line.destinationId ?? ""}
                options={[
                  { value: "", label: "Unassigned" },
                  ...accounts.map((account) => ({ value: account.id, label: account.name })),
                  ...(line.destinationId &&
                  !accounts.some((account) => account.id === line.destinationId)
                    ? [{ value: line.destinationId, label: "Unavailable account" }]
                    : []),
                ]}
                onCommit={(destinationId) =>
                  update(line.id, { destinationId: destinationId || null })
                }
              />
            ),
          },
          {
            id: "actions",
            label: "Actions",
            sortable: false,
            value: () => "",
            render: (line) => (
              <Button
                size="small"
                color="inherit"
                onClick={() => onChange(lines.filter((item) => item.id !== line.id))}
              >
                Remove
              </Button>
            ),
          },
        ]}
      />
      <Button
        sx={{ alignSelf: "flex-start" }}
        onClick={() =>
          onChange([
            ...lines,
            {
              id: crypto.randomUUID(),
              name: tableId === "expenses" ? "New expense" : "New saving",
              amount: "0.00",
              frequency: "monthly",
              destinationId: null,
            },
          ])
        }
      >
        {addLabel}
      </Button>
    </Stack>
  );
}
