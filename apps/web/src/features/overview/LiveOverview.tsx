import { accountAsset } from "@wealth/domain";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AssetFilter } from "./AssetFilter";
import {
  allAssets,
  selectedAssets,
  selectedNetWorth,
  filterNetWorthPoints,
} from "./assetSelection";
import type { AssetKind } from "./assetSelection";
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Link } from "react-router";
import { formatGbp, formatMonth, pence } from "@wealth/domain";
import type { HistoryRange, Pence } from "@wealth/domain";
import type { AppData } from "../../lib/data";
import { api } from "../../lib/api";
import { PageHeading } from "../../components/PageHeading";
import { TimelineChart } from "../../components/charts/TimelineChart";
import { colors, historyPoints } from "../../components/charts/chartData";
import { OverviewCharts } from "./OverviewCharts";
import { ReserveCoverage } from "../reserves/ReserveCoverage";
import { formatSignedGbp } from "../../lib/money";
const rate = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
const money = (value: Pence | null | undefined) =>
  value === null || value === undefined ? "—" : formatGbp(value);
function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 1 }}>
      <Typography color="text.secondary" sx={{ fontSize: 13 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 14, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>
        {value}
      </Typography>
    </Box>
  );
}
function Goal({
  label,
  value,
  target,
  arrival,
}: {
  readonly label: string;
  readonly value: Pence;
  readonly target: Pence;
  readonly arrival?: { reached: boolean; month: string | null } | null;
}) {
  return (
    <Box sx={{ mt: 3, pt: 3, borderTop: 1, borderColor: "divider" }}>
      <Typography component="h3" sx={{ fontSize: 15, mb: 1.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 22 }}>
        {formatGbp(value)}{" "}
        <Box component="span" sx={{ fontSize: 13, color: "text.secondary" }}>
          / {formatGbp(target)}
        </Box>
      </Typography>
      <LinearProgress
        variant="determinate"
        value={target <= 0 ? 100 : Math.max(0, Math.min(100, (value / target) * 100))}
        aria-label={`${label} progress`}
        sx={{ my: 2 }}
      />
      <Typography color="text.secondary" sx={{ fontSize: 12 }}>
        {value >= target
          ? "Goal reached"
          : arrival?.month
            ? `Projected arrival: ${formatMonth(arrival.month as Parameters<typeof formatMonth>[0])}`
            : "No arrival estimate at the current saving rate."}
      </Typography>
    </Box>
  );
}
export function LiveOverview({
  data,
  onRecord,
}: {
  readonly data: AppData;
  readonly onRecord: () => void;
}) {
  const [range, setRange] = useState<HistoryRange>("1Y");
  const client = useQueryClient();
  const [assets, setAssets] = useState<AssetKind[]>(
    () => data.overview?.netWorthAssets ?? allAssets,
  );
  // A shared scope runs saves in order, so the last selection is the one stored.
  const saveAssets = useMutation({
    scope: { id: "overview-settings" },
    mutationFn: (netWorthAssets: AssetKind[]) => api.overview.save.mutate({ netWorthAssets }),
    onSuccess: (overview) =>
      client.setQueryData<AppData>(["wealth"], (previous) => previous && { ...previous, overview }),
  });
  const visibleAssets = selectedAssets(assets);
  const totalLabel = assets.length === allAssets.length ? "Net worth" : "Selected net worth";
  const latest = data.snapshots.at(-1),
    previous = data.snapshots.at(-2);
  const summary = data.budgetSummary,
    projections = data.projections,
    plan = data.budget?.plan;
  const metric = data.metrics.at(-1)?.result;
  const currentTotal = latest ? selectedNetWorth(latest, assets) : pence(0);
  const previousTotal = previous ? selectedNetWorth(previous, assets) : pence(0);
  return (
    <>
      <PageHeading title="Overview">
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ gap: 2, alignItems: { sm: "center" }, width: { xs: "100%", sm: "auto" } }}
        >
          <Typography color="text.secondary" sx={{ fontSize: 13 }}>
            {latest ? `Recorded ${formatMonth(latest.month)}` : formatMonth(data.currentMonth)}
          </Typography>
          {latest && (
            <AssetFilter
              value={assets}
              onChange={(value) => {
                setAssets(value);
                saveAssets.mutate(value);
              }}
            />
          )}
        </Stack>
      </PageHeading>
      {saveAssets.isError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Your asset selection couldn’t be saved. It will reset when you reload.
        </Alert>
      )}
      {!latest ? (
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 } }}>
          <Typography component="h2" sx={{ fontSize: 22, mb: 1 }}>
            Record your starting point
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Add your accounts, then save this month’s balances.
          </Typography>
          <Stack direction="row" spacing={2}>
            <Button component={Link} to="/accounts" variant="outlined">
              Add accounts
            </Button>
            <Button variant="contained" onClick={onRecord}>
              Record snapshot
            </Button>
          </Stack>
        </Paper>
      ) : (
        <>
          <Paper variant="outlined" sx={{ borderRadius: "12px", px: { xs: 2, sm: 3.75 }, pt: 3.5 }}>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                gap: 2,
                flexWrap: "wrap",
                mb: 3,
              }}
            >
              <Box>
                <Typography component="h2" color="text.secondary" sx={{ fontSize: 14 }}>
                  {totalLabel}
                </Typography>
                <Typography
                  sx={{
                    fontSize: { xs: 32, sm: 46 },
                    lineHeight: 1.15,
                    letterSpacing: "-1.6px",
                    fontWeight: 550,
                    mt: 1,
                  }}
                >
                  {formatGbp(currentTotal)}
                </Typography>
                {previous && (
                  <Typography sx={{ fontSize: 12, mt: 0.75 }} color="text.secondary">
                    <Box
                      component="span"
                      sx={{
                        color: currentTotal >= previousTotal ? "success.main" : "error.main",
                        mr: 1,
                      }}
                    >
                      {formatSignedGbp(pence(currentTotal - previousTotal))}
                      {previousTotal > 0
                        ? ` (${(((currentTotal - previousTotal) / previousTotal) * 100).toFixed(1)}%)`
                        : ""}
                    </Box>
                    since {formatMonth(previous.month)}
                  </Typography>
                )}
              </Box>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={range}
                onChange={(_, value: HistoryRange | null) => value && setRange(value)}
                aria-label="Chart range"
                sx={{ alignSelf: "start" }}
              >
                {(["6M", "YTD", "1Y", "All"] as const).map((value) => (
                  <ToggleButton value={value} key={value}>
                    {value}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
            <TimelineChart
              points={filterNetWorthPoints(
                historyPoints(data.snapshots, range, data.currentMonth),
                assets,
              )}
              series={[
                ...visibleAssets.map((asset) => ({
                  key: asset.key,
                  name: asset.label,
                  color: colors[asset.key],
                  type: "bar" as const,
                  stack: "assets",
                })),
                { key: "total", name: totalLabel, color: colors.total, type: "line" },
              ]}
            />
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: `repeat(${assets.length},1fr)` },
                borderTop: 1,
                borderColor: "divider",
                mt: 2,
                py: 3,
                gap: 3,
              }}
            >
              {visibleAssets.map(({ key, field, label }) => {
                const value = latest[field],
                  color = colors[key];
                return (
                  <Box key={label}>
                    <Typography
                      color="text.secondary"
                      sx={{ fontSize: 12, display: "flex", alignItems: "center", gap: 1 }}
                    >
                      <Box
                        component="span"
                        sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: color }}
                      />
                      {label}
                    </Typography>
                    <Typography sx={{ fontSize: 22, mt: 1 }}>{formatGbp(value)}</Typography>
                    {previous && (
                      <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>
                        {formatSignedGbp(pence(value - previous[field]))} since{" "}
                        {formatMonth(previous.month)}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Paper>
          <OverviewCharts data={data} range={range} assets={assets} />
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "minmax(0,1.5fr) minmax(280px,1fr)" },
              gap: 4,
              mt: 4,
            }}
          >
            <Box>
              <Typography component="h2" sx={{ fontSize: 17, mb: 2 }}>
                Recorded balances
              </Typography>
              {latest.source === "historical" ? (
                <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                  This month contains manually entered totals.
                </Typography>
              ) : (
                <>
                  {latest.balances
                    .filter((balance) => assets.includes(accountAsset(balance.kind)))
                    .map((balance) => (
                      <Stat
                        key={balance.accountId}
                        label={balance.name}
                        value={formatGbp(balance.balance)}
                      />
                    ))}
                  {assets.includes("investments") &&
                    latest.investments.map((investment) => (
                      <Stat
                        key={investment.connectionId}
                        label={investment.name}
                        value={formatGbp(investment.total)}
                      />
                    ))}
                </>
              )}
              <Box sx={{ borderTop: 1, borderColor: "divider", mt: 2, pt: 1 }}>
                <Stat label={totalLabel} value={formatGbp(currentTotal)} />
              </Box>
              <Box sx={{ mt: 4 }}>
                <Typography component="h2" sx={{ fontSize: 17, mb: 1 }}>
                  Savings & spending
                </Typography>
                {metric?.status === "complete" ? (
                  <>
                    <Typography color="text.secondary" sx={{ fontSize: 12, mb: 2 }}>
                      {new Date(metric.start).toLocaleDateString("en-GB", {
                        timeZone: "Europe/London",
                      })}{" "}
                      –{" "}
                      {new Date(metric.end).toLocaleDateString("en-GB", {
                        timeZone: "Europe/London",
                      })}
                    </Typography>
                    <Stat
                      label={
                        latest.historicalSavings?.assumedMonthlyIncome != null
                          ? "Assumed income + investment income"
                          : "Confirmed income + investment income"
                      }
                      value={formatGbp(metric.income)}
                    />
                    <Stat label="Saved, excluding pensions" value={formatGbp(metric.saved)} />
                    <Stat label="Inferred spending" value={formatGbp(metric.spending)} />
                    <Stat label="Savings rate" value={rate(metric.rate)} />
                  </>
                ) : (
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                    {metric?.reason ?? "Record two balance readings to calculate savings."}
                  </Typography>
                )}
                {projections &&
                  (projections.yearSaved !== null ||
                    projections.recentRate !== null ||
                    projections.averageSpending !== null) && (
                    <Box sx={{ borderTop: 1, borderColor: "divider", mt: 2, pt: 1 }}>
                      <Stat
                        label={`${data.currentMonth.slice(0, 4)} recorded savings`}
                        value={money(projections.yearSaved)}
                      />
                      <Stat label="Savings rate this year" value={rate(projections.yearRate)} />
                      <Stat label="Last three intervals" value={rate(projections.recentRate)} />
                      {projections.recentRate !== null && projections.previousRate !== null && (
                        <Stat
                          label="Change from previous three"
                          value={`${((projections.recentRate - projections.previousRate) * 100).toFixed(1)} percentage points`}
                        />
                      )}
                      <Stat
                        label="Inferred monthly spending: last six months"
                        value={money(projections.averageSpending)}
                      />
                      {summary && projections.averageSpending !== null && (
                        <Stat
                          label="Inferred spending versus plan"
                          value={formatSignedGbp(
                            pence(projections.averageSpending - summary.spending),
                          )}
                        />
                      )}
                    </Box>
                  )}
              </Box>
              {plan && (
                <Box sx={{ mt: 4 }}>
                  <ReserveCoverage plan={plan} snapshots={data.snapshots} settingsLink />
                </Box>
              )}
            </Box>
            <Box sx={{ borderLeft: { lg: 1 }, borderColor: { lg: "divider" }, pl: { lg: 3.75 } }}>
              <Typography component="h2" sx={{ fontSize: 17, mb: 2 }}>
                Monthly budget
              </Typography>
              {summary ? (
                <>
                  <Stat label="Income" value={formatGbp(summary.income)} />
                  <Stat label="Planned spending" value={formatGbp(summary.spending)} />
                  <Stat
                    label="Available to save"
                    value={formatGbp(pence(summary.income - summary.spending))}
                  />
                  <Stat label="Surplus to cash" value={money(summary.cashAllocation)} />
                  <Stat
                    label="Surplus to investments"
                    value={money(summary.investmentAllocation)}
                  />
                  <Stat label="Emergency target" value={money(summary.emergency)} />
                </>
              ) : (
                <Button component={Link} to="/budget">
                  Set up your budget
                </Button>
              )}
              {plan?.cashGoal !== null && plan?.cashGoal !== undefined && (
                <Goal
                  label="Cash savings goal"
                  value={latest.cash}
                  target={plan.cashGoal}
                  arrival={projections?.cashGoal ?? null}
                />
              )}
              {plan?.endOfYearGoal !== null && plan?.endOfYearGoal !== undefined && (
                <Box sx={{ borderTop: 1, borderColor: "divider", mt: 3, pt: 3 }}>
                  <Typography component="h3" sx={{ fontSize: 15, mb: 1 }}>
                    Year-end cash: {data.currentMonth.slice(0, 4)}
                  </Typography>
                  <Stat label="Goal" value={formatGbp(plan.endOfYearGoal)} />
                  <Stat
                    label="Projected balance"
                    value={money(projections?.projectedYearEndCash)}
                  />
                  <Stat
                    label="Monthly cash saving needed"
                    value={money(
                      projections?.yearEndMonthlyGap === null ||
                        projections?.yearEndMonthlyGap === undefined
                        ? null
                        : pence(Math.max(0, projections.yearEndMonthlyGap)),
                    )}
                  />
                </Box>
              )}
              {projections?.deposit && (
                <Goal
                  label="House deposit"
                  value={projections.deposit.eligible}
                  target={projections.deposit.target}
                  arrival={projections.deposit.arrival}
                />
              )}
              {projections && projections.eligibleIntervals > 0 && (
                <Box sx={{ borderTop: 1, borderColor: "divider", mt: 3, pt: 3 }}>
                  <Typography component="h3" sx={{ fontSize: 15, mb: 1 }}>
                    Projection basis
                  </Typography>
                  <Stat label="Cash saved per month" value={money(projections.monthlyCash)} />
                  <Stat label="Total saved per month" value={money(projections.monthlySaved)} />
                  <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>
                    {projections.eligibleIntervals
                      ? `${projections.eligibleIntervals} complete intervals covering ${Math.round(projections.coveredDays)} days, as of ${formatMonth(projections.asOf)}.`
                      : "No complete intervals in the projection window."}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        </>
      )}
    </>
  );
}
