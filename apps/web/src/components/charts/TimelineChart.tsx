import { Box, Stack, Typography } from "@mui/material";
import { darken, useTheme } from "@mui/material/styles";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatGbp, pence } from "@wealth/domain";
import type { TimePoint } from "./chartData";
import { colors, shortMonth } from "./chartData";
import { axisTick, ChartEmpty, compactMoney, tooltipStyle } from "./ChartFrame";
export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  type: "bar" | "line";
  stack?: string;
  signed?: boolean;
}
export function TimelineChart({
  points,
  series,
  percent = false,
  detailKey = "detail",
  empty = "No recorded values in this range.",
}: {
  readonly points: TimePoint[];
  readonly series: ChartSeries[];
  readonly percent?: boolean;
  readonly detailKey?: string;
  readonly empty?: string;
}) {
  const theme = useTheme();
  const visibleSeries = series.map((item) => ({
    ...item,
    color:
      theme.palette.mode === "light" && item.type === "line" && item.color.startsWith("#")
        ? darken(item.color, 0.25)
        : item.color,
  }));
  if (!points.some((point) => series.some((item) => typeof point[item.key] === "number")))
    return <ChartEmpty>{empty}</ChartEmpty>;
  return (
    <>
      <Box sx={{ height: 280, minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={points}
            stackOffset="sign"
            margin={{ top: 12, right: 8, left: 0, bottom: 4 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" />
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickFormatter={shortMonth}
              axisLine={false}
              tickLine={false}
              minTickGap={28}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={axisTick}
              tickFormatter={(value) => (percent ? value + "%" : compactMoney(Number(value)))}
              axisLine={false}
              tickLine={false}
              width={65}
            />
            <ReferenceLine y={0} stroke="var(--chart-muted)" />
            <Tooltip
              formatter={(value, name) => [
                percent ? Number(value).toFixed(1) + "%" : formatGbp(pence(Number(value))),
                name,
              ]}
              labelFormatter={(label, payload) =>
                String(payload[0]?.payload[detailKey] ?? shortMonth(label))
              }
              contentStyle={tooltipStyle}
              itemStyle={{ color: "var(--chart-text)" }}
              cursor={{ stroke: "var(--chart-muted)", fill: "var(--chart-hover)" }}
            />
            {visibleSeries.map((item) =>
              item.type === "bar" ? (
                <Bar
                  key={item.key}
                  name={item.name}
                  dataKey={item.key}
                  fill={item.color}
                  {...(item.stack ? { stackId: item.stack } : {})}
                  maxBarSize={32}
                  isAnimationActive={false}
                >
                  {item.signed &&
                    points.map((point) => (
                      <Cell
                        key={point.label}
                        fill={Number(point[item.key]) < 0 ? colors.negative : item.color}
                      />
                    ))}
                </Bar>
              ) : (
                <Line
                  key={item.key}
                  name={item.name}
                  dataKey={item.key}
                  type="linear"
                  stroke={item.color}
                  strokeWidth={2}
                  dot={{ r: 2, strokeWidth: 0, fill: item.color }}
                  connectNulls
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <Stack direction="row" sx={{ gap: 2, justifyContent: "center", flexWrap: "wrap", mt: 1 }}>
        {visibleSeries.map((item) => (
          <Typography
            key={item.key}
            sx={{
              borderBottom: "2px solid",
              borderColor: item.color,
              pb: 0.5,
              fontSize: 12,
              color: "text.secondary",
            }}
          >
            {item.name}
          </Typography>
        ))}
      </Stack>
    </>
  );
}
