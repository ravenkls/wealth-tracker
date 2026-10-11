import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, Paper, Skeleton, Stack, Typography } from "@mui/material";
import {
  formatGbp,
  liveBudget,
  liveBudgetAt,
  monthlyBudgets,
  pence,
  type BudgetPlan,
  type LiveBudget,
  type LiveBudgetRow,
  type LiveBudgetTotals,
} from "@wealth/domain";
import { PageHeading } from "../../components/PageHeading";
import { api } from "../../lib/api";
import { errorMessage, useRefresh, type AppData } from "../../lib/data";
import { useCategories } from "../analysis/CategoriesPanel";
import { categoryKey, monthRange } from "../analysis/ledgerModel";
import { useLedger } from "../analysis/useLedger";

const currentMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7);
function monthBounds(value: string) {
  const [year, month] = value.split("-").map(Number);
  return {
    start: new Date(year!, month! - 1, 1).getTime(),
    end: new Date(year!, month!, 1).getTime(),
  };
}

export function LiveBudgetPage({ data }: { readonly data: AppData }) {
  const plan = data.budget?.plan ?? null;
  const [month, setMonth] = useState(currentMonth);
  const ledger = useLedger(monthRange(month));
  const categories = useCategories();
  const spend = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of ledger.entries)
      if (entry.currency === "GBP" && entry.amount < 0)
        totals.set(categoryKey(entry), (totals.get(categoryKey(entry)) ?? 0) - entry.amount);
    return totals;
  }, [ledger.entries]);
  const budgeted = !!plan && monthlyBudgets(plan).size > 0;
  const live =
    plan && ledger.ready && categories.data
      ? liveBudget({ plan, categories: categories.data.categories, spend })
      : null;
  const error = ledger.query.error ?? categories.error;
  return (
    <>
      <PageHeading title="Live budget" />
      {!budgeted ? (
        <Alert
          severity="info"
          action={
            <Button component={Link} to="/budget">
              Open budget
            </Button>
          }
        >
          Give your budget’s monthly expenses categories to see what you can spend right now.
        </Alert>
      ) : (
        <Stack sx={{ gap: 3 }}>
          {error ? (
            <Alert severity="error">{errorMessage(error)}</Alert>
          ) : live ? (
            <>
              <LiveCounter
                key={month}
                totals={live}
                month={month}
                onMonthEnd={() => setMonth(currentMonth())}
              />
              <Exclusions data={data} plan={plan!} live={live} />
            </>
          ) : (
            <Skeleton variant="rounded" height={260} />
          )}
        </Stack>
      )}
    </>
  );
}

// Show enough decimals that the last digit moves every frame.
function decimalsFor(totals: LiveBudgetTotals, start: number, end: number) {
  const poundsPerFrame = (totals.budget / 100 / (end - start)) * 16;
  return poundsPerFrame > 0 ? Math.min(8, Math.max(2, Math.ceil(-Math.log10(poundsPerFrame)))) : 2;
}
function countdown(milliseconds: number) {
  const seconds = Math.max(0, milliseconds) / 1000;
  const pad = (value: number) => String(Math.floor(value)).padStart(2, "0");
  return `${Math.floor(seconds / 86400)}d ${pad((seconds / 3600) % 24)}h ${pad((seconds / 60) % 60)}m ${(seconds % 60).toFixed(3).padStart(6, "0")}s`;
}

function LiveCounter({
  totals,
  month,
  onMonthEnd,
}: {
  readonly totals: LiveBudgetTotals;
  readonly month: string;
  readonly onMonthEnd: () => void;
}) {
  const { start, end } = monthBounds(month);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      setNow(Date.now());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const ended = now >= end;
  useEffect(() => {
    if (ended) onMonthEnd();
  }, [ended, onMonthEnd]);
  const { available, resumesAt } = liveBudgetAt(totals, start, end, Math.min(now, end));
  const decimals = decimalsFor(totals, start, end);
  const [whole, fraction] = (Math.max(0, available) / 100)
    .toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    .split(".");
  const perDay = pence(Math.round((totals.budget / (end - start)) * 86400000));
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Available to spend"
      sx={{ p: { xs: 3, sm: 5 } }}
    >
      <Typography color="text.secondary" sx={{ fontSize: 13 }}>
        Available to spend now
      </Typography>
      <Typography
        role="timer"
        aria-label={formatGbp(pence(Math.max(0, Math.floor(available))))}
        sx={{
          fontSize: { xs: 40, sm: 64 },
          fontWeight: 600,
          letterSpacing: "-1.5px",
          fontVariantNumeric: "tabular-nums",
          color: resumesAt === null ? "text.primary" : "text.secondary",
          overflowWrap: "anywhere",
        }}
      >
        £{whole}.{fraction!.slice(0, 2)}
        <Box component="span" sx={{ opacity: 0.4, fontSize: "0.55em", letterSpacing: 0 }}>
          {fraction!.slice(2)}
        </Box>
      </Typography>
      {resumesAt !== null && (
        <Box sx={{ mt: 2 }}>
          <Typography
            role="timer"
            sx={{
              fontSize: { xs: 22, sm: 28 },
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
            color="error"
          >
            {countdown(resumesAt - now)}
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 13 }}>
            {resumesAt === end
              ? "until next month’s budget starts"
              : `until you can spend again · ${formatGbp(pence(Math.ceil(-available)))} over pace`}
          </Typography>
        </Box>
      )}
      <Typography color="text.secondary" sx={{ fontSize: 13, mt: 3 }}>
        {formatGbp(totals.spent)} spent of {formatGbp(totals.budget)} this month · accruing{" "}
        {formatGbp(perDay)} a day
      </Typography>
    </Paper>
  );
}

function Exclusions({
  data,
  plan,
  live,
}: {
  readonly data: AppData;
  readonly plan: BudgetPlan;
  readonly live: LiveBudget;
}) {
  const refresh = useRefresh();
  const save = useMutation({
    mutationFn: (
      patch: Pick<BudgetPlan, "liveBudgetExclusions" | "liveBudgetExcludedCategoryIds">,
    ) =>
      api.budget.save.mutate({
        plan: { ...plan, ...patch },
        expectedVersion: data.budget!.version,
      }),
    onSuccess: () => refresh(),
  });
  const excludedAfter = (rows: readonly LiveBudgetRow[], toggled: string) =>
    rows.filter((row) => row.counted === (row.id === toggled)).map((row) => row.id);
  const chips = (rows: readonly LiveBudgetRow[], onToggle: (id: string) => void) => (
    <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
      {rows.map((row) => (
        <Chip
          key={row.id}
          label={`${row.name} · ${formatGbp(row.spent)}${row.budget === null ? "" : ` of ${formatGbp(row.budget)}`}`}
          color={row.counted ? "primary" : "default"}
          variant={row.counted ? "filled" : "outlined"}
          aria-pressed={row.counted}
          disabled={save.isPending}
          onClick={() => onToggle(row.id)}
          sx={row.counted ? undefined : { textDecoration: "line-through" }}
        />
      ))}
    </Stack>
  );
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Counted categories"
      sx={{ p: { xs: 2, sm: 2.5 } }}
    >
      <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
        Counted categories
      </Typography>
      <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5, mb: 2 }}>
        Exclude fixed costs like bills. An excluded budget category drops its budget and the
        spending in categories linked to it.
      </Typography>
      {chips(live.budgetRows, (id) =>
        save.mutate({ liveBudgetExclusions: excludedAfter(live.budgetRows, id) }),
      )}
      {!!live.spendingRows.length && (
        <>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mt: 3 }}>Outside your budget</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5, mb: 1.5 }}>
            Spending in categories not linked to a budget category, such as debt repayments.
          </Typography>
          {chips(live.spendingRows, (id) =>
            save.mutate({ liveBudgetExcludedCategoryIds: excludedAfter(live.spendingRows, id) }),
          )}
        </>
      )}
      {live.other > 0 && (
        <Typography color="text.secondary" sx={{ fontSize: 12, mt: 2 }}>
          Plus {formatGbp(live.other)} uncategorised spending, which always counts.
        </Typography>
      )}
      {save.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errorMessage(save.error)}
        </Alert>
      )}
    </Paper>
  );
}
