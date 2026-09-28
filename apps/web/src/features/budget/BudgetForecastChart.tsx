import { useState } from "react";
import { Alert, Box, MenuItem, TextField, Typography } from "@mui/material";
import {
  forecastBudget,
  formatGbp,
  formatMonth,
  type BudgetPlan,
  type Snapshot,
} from "@wealth/domain";
import { TimelineChart } from "../../components/charts/TimelineChart";
import { colors } from "../../components/charts/chartData";
import { ChartEmpty, ChartFrame } from "../../components/charts/ChartFrame";

export function BudgetForecastChart({
  plan,
  latest,
}: {
  readonly plan: BudgetPlan;
  readonly latest: Snapshot | null;
}) {
  const [horizon, setHorizon] = useState(12);
  let forecast: ReturnType<typeof forecastBudget>;
  try {
    forecast = forecastBudget(plan, latest, horizon);
  } catch {
    forecast = {
      status: "unavailable",
      reason:
        "The forecast exceeds the supported balance or date range. Reduce the amounts or forecast length.",
    };
  }
  const end = forecast.status === "complete" ? forecast.points.at(-1)! : null;
  const firstNegative =
    forecast.status === "complete" ? forecast.points.find((point) => point.cash < 0) : null;
  return (
    <ChartFrame
      title="Balance forecast"
      subtitle={
        latest
          ? `From ${formatMonth(latest.month)} using your current budget`
          : "Based on your current budget"
      }
      action={
        <TextField
          select
          size="small"
          label="Forecast length"
          value={horizon}
          onChange={(event) => setHorizon(Number(event.target.value))}
          sx={{ minWidth: 155 }}
        >
          {[12, 24, 60].map((value) => (
            <MenuItem key={value} value={value}>
              {value} months
            </MenuItem>
          ))}
        </TextField>
      }
    >
      {forecast.status === "unavailable" ? (
        <ChartEmpty>{forecast.reason}</ChartEmpty>
      ) : (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0,1fr)", md: "minmax(0,1fr) 215px" },
              gap: 3,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <TimelineChart
                points={forecast.points.map((point, index) => ({
                  label: point.month,
                  detail: `${formatMonth(point.month)} (${index ? "projected" : "recorded"})`,
                  cash: point.cash,
                  investments: point.investments,
                  total: point.total,
                }))}
                series={[
                  { key: "cash", name: "Net cash", type: "line", color: colors.cash, dashed: true },
                  {
                    key: "investments",
                    name: "Investments",
                    type: "line",
                    color: colors.investments,
                    dashed: true,
                  },
                  {
                    key: "total",
                    name: "Net worth",
                    type: "line",
                    color: colors.total,
                    dashed: true,
                  },
                ]}
              />
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", md: "1fr" },
                alignContent: "center",
                gap: 2.5,
                pl: { md: 3 },
                borderLeft: { md: 1 },
                borderColor: { md: "divider" },
                justifyContent: "center",
              }}
            >
              <Typography color="text.secondary" sx={{ fontSize: 13, gridColumn: "1 / -1" }}>
                Projected {formatMonth(end!.month)}
              </Typography>
              {(
                [
                  ["Net cash", end!.cash],
                  ["Investments", end!.investments],
                  ["Net worth", end!.total],
                ] as const
              ).map(([label, value]) => (
                <Box
                  key={label}
                  sx={{
                    gridColumn: label === "Net worth" ? { xs: "1 / -1", md: "auto" } : "auto",
                    minWidth: 0,
                  }}
                >
                  <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                    {label}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: { xs: 20, sm: 24 },
                      fontWeight: 550,
                      overflowWrap: "anywhere",
                      mt: 0.5,
                    }}
                  >
                    {formatGbp(value)}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
          {firstNegative && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Net cash is below zero in {formatMonth(firstNegative.month)} under this budget.
            </Alert>
          )}
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 2 }}>
            Monthly averages, including annual expenses. No growth or interest; pensions stay at
            their recorded value.
          </Typography>
        </>
      )}
    </ChartFrame>
  );
}
