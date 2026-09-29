import { useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  forecastBudget,
  formatGbp,
  formatMonth,
  type BudgetPlan,
  type BudgetDestination,
  type Snapshot,
} from "@wealth/domain";
import { ChartEmpty, ChartFrame } from "../../components/charts/ChartFrame";
import { ForecastRangeChart, type ForecastMetric } from "./ForecastRangeChart";
import { useBudgetSimulation } from "./useBudgetSimulation";

export function BudgetForecastChart({
  plan,
  latest,
  assumptions,
  destinations,
}: {
  readonly plan: BudgetPlan | null;
  readonly latest: Snapshot | null;
  readonly assumptions: ReactNode;
  readonly destinations: readonly BudgetDestination[];
}) {
  const [horizon, setHorizon] = useState(12);
  const [metric, setMetric] = useState<ForecastMetric>("total");
  const [expanded, setExpanded] = useState(false);
  const simulation = useBudgetSimulation(plan, latest, horizon, destinations);
  let forecast: ReturnType<typeof forecastBudget>;
  try {
    forecast = plan
      ? forecastBudget(plan, latest, horizon, destinations)
      : {
          status: "unavailable",
          reason: "Complete the budget and enter valid forecast assumptions to see the projection.",
        };
  } catch {
    forecast = {
      status: "unavailable",
      reason:
        "The forecast exceeds the supported balance or date range. Reduce the amounts or forecast length.",
    };
  }
  const end = simulation?.status === "complete" ? simulation.points.at(-1)! : null;
  const baselineEnd = forecast.status === "complete" ? forecast.points.at(-1)! : null;
  const firstNegative =
    simulation?.status === "complete"
      ? simulation.points.find((point) => point.cash.low < 0)
      : null;
  return (
    <ChartFrame
      title="Balance forecast (excl. pension)"
      subtitle={
        latest
          ? `From ${formatMonth(latest.month)} using your current budget`
          : "Based on your current budget"
      }
      action={
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            select
            size="small"
            label="Balance"
            value={metric}
            onChange={(event) => setMetric(event.target.value as ForecastMetric)}
            sx={{ minWidth: 135 }}
          >
            <MenuItem value="total">Net worth</MenuItem>
            <MenuItem value="cash">Net cash</MenuItem>
            <MenuItem value="investments">Investments</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Forecast length"
            value={horizon}
            onChange={(event) => setHorizon(Number(event.target.value))}
            sx={{ minWidth: 140 }}
          >
            {[12, 24, 60].map((value) => (
              <MenuItem key={value} value={value}>
                {value} months
              </MenuItem>
            ))}
          </TextField>
          <Button
            size="small"
            variant="outlined"
            aria-expanded={expanded}
            aria-controls="forecast-assumptions"
            onClick={() => setExpanded((value) => !value)}
          >
            Assumptions
          </Button>
        </Stack>
      }
    >
      <Collapse in={expanded}>
        <Box
          id="forecast-assumptions"
          sx={{ pt: 1, pb: 3, mb: 3, borderBottom: 1, borderColor: "divider" }}
        >
          {assumptions}
        </Box>
      </Collapse>
      {forecast.status === "unavailable" ? (
        <ChartEmpty>{forecast.reason}</ChartEmpty>
      ) : simulation?.status === "unavailable" ? (
        <ChartEmpty>{simulation.reason}</ChartEmpty>
      ) : !end || !baselineEnd || simulation?.status !== "complete" ? (
        <ChartEmpty>Calculating simulated balances…</ChartEmpty>
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
              <ForecastRangeChart
                points={simulation.points}
                baseline={forecast.points}
                metric={metric}
              />
            </Box>
            <Box
              sx={{
                alignSelf: "center",
                pl: { md: 3 },
                borderLeft: { md: 1 },
                borderColor: { md: "divider" },
                minWidth: 0,
              }}
            >
              <Typography color="text.secondary" sx={{ fontSize: 13, mb: 2 }}>
                Projected {formatMonth(end.month)}
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                Simulation median
              </Typography>
              <Typography
                sx={{
                  fontSize: { xs: 26, sm: 30 },
                  fontWeight: 550,
                  overflowWrap: "anywhere",
                  mt: 0.5,
                }}
              >
                {formatGbp(end[metric].median)}
              </Typography>
              <Box sx={{ mt: 2.5 }}>
                <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                  Middle 80% of simulations
                </Typography>
                <Typography sx={{ fontSize: 16, mt: 0.5, overflowWrap: "anywhere" }}>
                  {formatGbp(end[metric].low)} – {formatGbp(end[metric].high)}
                </Typography>
              </Box>
              <Box sx={{ mt: 2.5 }}>
                <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                  Budget only, no growth
                </Typography>
                <Typography sx={{ fontSize: 18, mt: 0.5 }}>
                  {formatGbp(baselineEnd[metric])}
                </Typography>
              </Box>
            </Box>
          </Box>
          {firstNegative && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              The lower cash estimate is below zero in {formatMonth(firstNegative.month)}.
            </Alert>
          )}
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 2 }}>
            {simulation.paths.toLocaleString("en-GB")} simulated paths. The shaded range reflects
            your assumptions, not guaranteed outcomes. Monthly averages include annual expenses.
          </Typography>
          {(simulation.brokerageCash > 0 || simulation.hasUnknownCash) && (
            <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5 }}>
              {simulation.brokerageCash > 0 &&
                `${formatGbp(simulation.brokerageCash)} of recorded brokerage cash is excluded from market returns. `}
              {simulation.hasUnknownCash &&
                "Investment amounts without a recorded cash breakdown are fully exposed to simulated returns."}
            </Typography>
          )}
        </>
      )}
    </ChartFrame>
  );
}
