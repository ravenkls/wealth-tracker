import { Box, Button, Stack, Typography } from "@mui/material";
import { Link } from "react-router";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  emergencyCoverage,
  formatGbp,
  formatMonth,
  type BudgetPlan,
  type Snapshot,
} from "@wealth/domain";
import { ChartFrame, ChartEmpty, axisTick, tooltipStyle } from "../../components/charts/ChartFrame";
import { shortMonth } from "../../components/charts/chartData";

export function ReserveCoverage({
  plan,
  snapshots,
  settingsLink = false,
}: {
  readonly plan: BudgetPlan;
  readonly snapshots: readonly Snapshot[];
  readonly settingsLink?: boolean;
}) {
  const coverage = emergencyCoverage(plan, snapshots);
  const current = coverage.current;
  return (
    <ChartFrame
      title="Emergency coverage"
      subtitle="Selected reserves against your current essential expenses"
      {...(settingsLink
        ? {
            action: (
              <Button component={Link} to="/budget" size="small">
                Configure
              </Button>
            ),
          }
        : {})}
    >
      {coverage.configurationReason ? (
        <ChartEmpty>{coverage.configurationReason}</ChartEmpty>
      ) : (
        <>
          <Stack direction="row" sx={{ alignItems: "baseline", flexWrap: "wrap", gap: 1, mb: 1 }}>
            <Typography sx={{ fontSize: 32, fontWeight: 550 }}>
              {current?.months == null ? "—" : current.months.toFixed(1)}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 14 }}>
              months covered
              {coverage.targetMonths === null ? "" : ` / ${coverage.targetMonths} target`}
            </Typography>
          </Stack>
          <Typography color="text.secondary" sx={{ fontSize: 13, mb: 2 }}>
            {current?.balance == null
              ? "Record a snapshot containing your selected reserve accounts."
              : `${formatGbp(current.balance)} recorded ${formatMonth(current.month)}`}
            <br />
            {formatGbp(coverage.monthlyEssentials)} essential expenses per month
          </Typography>
          {coverage.points.some((point) => point.months !== null) && (
            <Box sx={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={coverage.points}
                  margin={{ top: 12, left: 0, right: 20, bottom: 0 }}
                  accessibilityLayer
                >
                  <CartesianGrid
                    stroke="var(--chart-grid)"
                    strokeDasharray="3 5"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tickFormatter={shortMonth}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={axisTick}
                    tickFormatter={(value) => `${Number(value).toFixed(1)}m`}
                    width={42}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, "auto"]}
                  />
                  {coverage.targetMonths !== null && (
                    <ReferenceLine
                      y={coverage.targetMonths}
                      stroke="var(--chart-muted)"
                      strokeDasharray="4 4"
                      ifOverflow="extendDomain"
                    />
                  )}
                  <Tooltip
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: "var(--chart-text)" }}
                    labelFormatter={shortMonth}
                    formatter={(value) => [`${Number(value).toFixed(1)} months`, "Coverage"]}
                  />
                  <Line
                    name="Coverage"
                    dataKey="months"
                    type="linear"
                    stroke="var(--chart-total)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          )}
          {coverage.shortfall !== null && (
            <Typography
              sx={{ fontSize: 13, mt: 2 }}
              color={coverage.shortfall > 0 ? "text.secondary" : "success.main"}
            >
              {coverage.shortfall > 0
                ? `${formatGbp(coverage.shortfall)} below target`
                : "Reserve target met"}
            </Typography>
          )}
          {coverage.points.some((point) => point.months === null) && (
            <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>
              History is unavailable where selected account balances weren’t recorded.
            </Typography>
          )}
        </>
      )}
    </ChartFrame>
  );
}
