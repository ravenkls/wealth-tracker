import { Box, Stack, Typography } from "@mui/material";
import { darken, useTheme } from "@mui/material/styles";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatGbp,
  formatMonth,
  pence,
  type ForecastPoint,
  type SimulationPoint,
} from "@wealth/domain";
import { colors, shortMonth } from "../../components/charts/chartData";
import { axisTick, compactMoney, tooltipStyle } from "../../components/charts/ChartFrame";
export type ForecastMetric = "total" | "cash" | "investments";
export function ForecastRangeChart({
  points,
  baseline,
  metric,
}: {
  readonly points: SimulationPoint[];
  readonly baseline: ForecastPoint[];
  readonly metric: ForecastMetric;
}) {
  const theme = useTheme();
  const accent = metric === "cash" ? colors.cash : colors.investments;
  const line = theme.palette.mode === "light" ? darken(accent, 0.35) : accent;
  const data = points.map((point, index) => ({
    month: point.month,
    detail: `${formatMonth(point.month)} (${index ? "projected" : "recorded"})`,
    band: [point[metric].low, point[metric].high],
    median: point[metric].median,
    baseline: baseline[index]![metric],
  }));
  return (
    <>
      <Box sx={{ height: { xs: 280, sm: 320 }, minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 12, right: 8, left: 0, bottom: 4 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" />
            <XAxis
              dataKey="month"
              tick={axisTick}
              tickFormatter={shortMonth}
              axisLine={false}
              tickLine={false}
              minTickGap={28}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={axisTick}
              tickFormatter={(value) => compactMoney(Number(value))}
              axisLine={false}
              tickLine={false}
              width={65}
            />
            <ReferenceLine y={0} stroke="var(--chart-muted)" />
            <Area
              dataKey="band"
              name="Middle 80%"
              type="linear"
              stroke="none"
              fill={accent}
              fillOpacity={0.22}
              isAnimationActive={false}
            />
            <Line
              dataKey="baseline"
              name="Budget only"
              type="linear"
              stroke="var(--chart-total)"
              strokeDasharray="5 4"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="median"
              name="Simulation median"
              type="linear"
              stroke={line}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip
              formatter={(value, name) => [
                Array.isArray(value)
                  ? value.map((amount) => formatGbp(pence(Number(amount)))).join(" – ")
                  : formatGbp(pence(Number(value))),
                name,
              ]}
              labelFormatter={(_, payload) => String(payload[0]?.payload.detail ?? "")}
              contentStyle={tooltipStyle}
              itemStyle={{ color: "var(--chart-text)" }}
              cursor={{ stroke: "var(--chart-muted)" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <Stack direction="row" sx={{ gap: 2.5, flexWrap: "wrap", justifyContent: "center", mt: 1 }}>
        {(
          [
            ["Simulation median", line, "solid"],
            ["Budget only", "var(--chart-total)", "dashed"],
            ["Middle 80%", accent, "band"],
          ] as const
        ).map(([name, color, style]) => (
          <Box key={name} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box
              sx={
                style === "band"
                  ? { width: 16, height: 10, bgcolor: color, opacity: 0.35, borderRadius: 0.5 }
                  : { width: 16, borderTop: "2px", borderTopStyle: style, borderColor: color }
              }
            />
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>
              {name}
            </Typography>
          </Box>
        ))}
      </Stack>
    </>
  );
}
