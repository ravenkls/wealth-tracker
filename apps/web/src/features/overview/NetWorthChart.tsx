import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatGbp, formatMonth, month, pence } from "@wealth/domain";
import type { Month, Pence } from "@wealth/domain";

export function NetWorthChart({
  history,
}: {
  readonly history: readonly { month: Month; total: Pence | null }[];
}) {
  const fillId = useId();
  return (
    <div style={{ height: 253, marginTop: 18 }} aria-label="Recorded monthly net worth">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...history]} margin={{ top: 22, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#86aaf0" stopOpacity={0.19} />
              <stop offset="100%" stopColor="#86aaf0" stopOpacity={0.005} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
            tickFormatter={(value) =>
              formatMonth(month(String(value)))
                .split(" ")[0]!
                .slice(0, 3)
            }
            tickMargin={16}
            padding={{ left: 12, right: 4 }}
            interval="preserveStartEnd"
            minTickGap={25}
            height={43}
          />
          <YAxis
            orientation="right"
            domain={["auto", "auto"]}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => `£${Number(value) / 100000}k`}
            tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
            width={65}
            tickMargin={12}
          />
          <Tooltip
            formatter={(value) => formatGbp(pence(Number(value)))}
            labelFormatter={(label) => formatMonth(month(String(label)))}
            contentStyle={{
              background: "var(--chart-surface)",
              border: "1px solid var(--chart-border)",
              borderRadius: 7,
              color: "var(--chart-text)",
            }}
            itemStyle={{ color: "var(--chart-text)" }}
            cursor={{ stroke: "var(--chart-muted)", strokeDasharray: "4 4" }}
          />
          <Area
            type="linear"
            name="Net worth"
            dataKey="total"
            stroke="#91b4f5"
            strokeWidth={2.5}
            fill={`url(#${fillId})`}
            isAnimationActive={false}
            dot={{ r: 3, fill: "#91b4f5", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "#bbd2ff", stroke: "var(--chart-surface)", strokeWidth: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
