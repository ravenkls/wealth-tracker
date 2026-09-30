import { useState } from "react";
import { Box, Button, Stack, Typography, useMediaQuery } from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  Text,
  XAxis,
  YAxis,
} from "recharts";
import type { AmountPoint } from "./chartData";
import { palette, colors } from "./chartData";
import { axisTick, ChartEmpty, chartMoney, compactCurrencyMoney, tooltipStyle } from "./ChartFrame";
export function BreakdownChart({
  points,
  currency = "GBP",
  kind = "bars",
  empty = "No amounts to show yet.",
}: {
  readonly points: AmountPoint[];
  readonly currency?: string;
  readonly kind?: "bars" | "donut";
  readonly empty?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const narrow = useMediaQuery("(max-width: 599px)");
  const labelWidth = narrow ? 112 : 170;
  const rows = points.map((point, index) => ({
    ...point,
    color: point.value < 0 ? colors.negative : (point.color ?? palette[index % palette.length]!),
  }));
  const visibleRows = expanded ? rows : rows.slice(0, 6);
  if (!rows.length || rows.every((row) => row.value === 0)) return <ChartEmpty>{empty}</ChartEmpty>;
  const positive = rows.filter((row) => row.value > 0),
    total = positive.reduce((sum, row) => sum + row.value, 0);
  if (kind === "donut" && rows.every((row) => row.value >= 0))
    return (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "minmax(160px,0.9fr) minmax(0,1.1fr)" },
          alignItems: "center",
          gap: 2,
        }}
      >
        <Box sx={{ height: { xs: 200, sm: 240 }, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart accessibilityLayer>
              <Pie
                data={positive}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="86%"
                stroke="var(--chart-surface)"
                strokeWidth={3}
                isAnimationActive={false}
              >
                {positive.map((row) => (
                  <Cell key={row.id} fill={row.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => chartMoney(Number(value), currency)}
                contentStyle={tooltipStyle}
                itemStyle={{ color: "var(--chart-text)" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </Box>
        <Stack spacing={1.5} sx={{ maxHeight: { sm: 280 }, overflowY: "auto", pr: 1, py: 0.5 }}>
          {positive.map((row) => (
            <Box key={row.id} sx={{ borderLeft: "3px solid", borderColor: row.color, pl: 1.5 }}>
              <Typography sx={{ fontSize: 13, overflowWrap: "anywhere" }}>{row.name}</Typography>
              <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.3 }}>
                {chartMoney(row.value, currency)} ({((row.value / total) * 100).toFixed(1)}%)
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>
    );
  return (
    <Box>
      <Box sx={{ height: Math.max(220, visibleRows.length * 48 + 40), minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={visibleRows}
            layout="vertical"
            margin={{ left: 0, right: 16, top: 8, bottom: 8 }}
            accessibilityLayer
          >
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" strokeDasharray="3 5" />
            <XAxis
              type="number"
              orientation="top"
              tickCount={narrow ? 3 : 5}
              tickFormatter={(value) => compactCurrencyMoney(Number(value), currency)}
              tick={axisTick}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="id"
              width={labelWidth}
              interval={0}
              tick={({ x, y, payload }) => {
                const name =
                  rows.find((row) => row.id === payload.value)?.name ?? String(payload.value);
                return (
                  <g>
                    <title>{name}</title>
                    <Text
                      x={Number(x) - 8}
                      y={Number(y)}
                      width={labelWidth - 14}
                      textAnchor="end"
                      verticalAnchor="middle"
                      maxLines={3}
                      style={{ fontSize: 11 }}
                      fill={axisTick.fill}
                    >
                      {name}
                    </Text>
                  </g>
                );
              }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine x={0} stroke="var(--chart-muted)" />
            <Tooltip
              formatter={(value) => [chartMoney(Number(value), currency), "Value"]}
              labelFormatter={(label) =>
                rows.find((row) => row.id === label)?.name ?? String(label)
              }
              contentStyle={tooltipStyle}
              itemStyle={{ color: "var(--chart-text)" }}
              cursor={{ fill: "var(--chart-hover)" }}
            />
            <Bar dataKey="value" maxBarSize={18} isAnimationActive={false}>
              {visibleRows.map((row) => (
                <Cell key={row.id} fill={row.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
      {rows.length > 6 && (
        <Button
          size="small"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          sx={{ mt: 1 }}
        >
          {expanded ? "Show fewer" : `Show all ${rows.length}`}
        </Button>
      )}
    </Box>
  );
}
