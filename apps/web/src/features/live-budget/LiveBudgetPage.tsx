import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, Paper, Skeleton, Stack, Typography } from "@mui/material";
import {
  canonicalCategory,
  formatGbp,
  liveBudgetAt,
  liveBudgetTotals,
  monthlyBudgets,
  pence,
  type BudgetPlan,
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
  const budgets = plan ? [...monthlyBudgets(plan)] : [];
  const ready = ledger.ready && !!categories.data;
  const totals =
    plan && ready ? liveBudgetTotals({ plan, links: categories.data!.categories, spend }) : null;
  const error = ledger.query.error ?? categories.error;
  return (
    <>
      <PageHeading title="Live budget" />
      {!plan || !budgets.length ? (
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
          ) : totals ? (
            <LiveCounter
              key={month}
              totals={totals}
              month={month}
              onMonthEnd={() => setMonth(currentMonth())}
            />
          ) : (
            <Skeleton variant="rounded" height={260} />
          )}
          <Exclusions data={data} plan={plan} budgets={budgets} />
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
  budgets,
}: {
  readonly data: AppData;
  readonly plan: BudgetPlan;
  readonly budgets: readonly [string, number][];
}) {
  const refresh = useRefresh();
  const names = budgets.map(([name]) => name);
  const excluded = new Set(
    (plan.liveBudgetExclusions ?? []).map((name) => canonicalCategory(name, names)),
  );
  const save = useMutation({
    mutationFn: (liveBudgetExclusions: string[]) =>
      api.budget.save.mutate({
        plan: { ...plan, liveBudgetExclusions },
        expectedVersion: data.budget!.version,
      }),
    onSuccess: () => refresh(),
  });
  const toggle = (name: string) =>
    save.mutate(
      excluded.has(name)
        ? names.filter((other) => excluded.has(other) && other !== name)
        : [...names.filter((other) => excluded.has(other)), name],
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
        Exclude fixed costs like bills. Their budget and any spending in linked categories are left
        out. Other spending, including uncategorised, still counts.
      </Typography>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        {budgets.map(([name, amount]) => {
          const counted = !excluded.has(name);
          return (
            <Chip
              key={name}
              label={`${name} · ${formatGbp(pence(amount))}`}
              color={counted ? "primary" : "default"}
              variant={counted ? "filled" : "outlined"}
              aria-pressed={counted}
              disabled={save.isPending}
              onClick={() => toggle(name)}
              sx={counted ? undefined : { textDecoration: "line-through" }}
            />
          );
        })}
      </Stack>
      {save.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errorMessage(save.error)}
        </Alert>
      )}
    </Paper>
  );
}
