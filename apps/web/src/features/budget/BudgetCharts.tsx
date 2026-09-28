import { Box } from "@mui/material";
import { IncomeFlowChart } from "./IncomeFlowChart";
import type { BudgetPlan, Snapshot } from "@wealth/domain";
import { BreakdownChart } from "../../components/charts/BreakdownChart";
import { ChartFrame, chartGrid } from "../../components/charts/ChartFrame";
import { budgetChartData, colors } from "../../components/charts/chartData";
export function BudgetCharts({
  plan,
  latest,
  destinations,
}: {
  readonly plan: BudgetPlan;
  readonly latest: Snapshot | null;
  readonly destinations: { id: string; name: string }[];
}) {
  const { summary, expenses, categories } = budgetChartData(plan, latest);
  return (
    <Box sx={{ mt: 4 }}>
      <Box sx={{ mb: 3 }}>
        <IncomeFlowChart plan={plan} latest={latest} destinations={destinations} />
      </Box>
      <Box
        sx={{
          ...chartGrid,
          gridTemplateColumns: { xs: "minmax(0,1fr)", xl: "repeat(3,minmax(0,1fr))" },
        }}
      >
        <ChartFrame title="Category breakdown" subtitle="Monthly expenses and planned savings">
          <BreakdownChart
            kind="donut"
            points={categories}
            empty="Add budget items to see category totals."
          />
        </ChartFrame>
        <ChartFrame
          title="Spending breakdown"
          subtitle="Monthly amounts, including annual provisions"
        >
          <BreakdownChart points={expenses} empty="Add expenses to compare spending." />
        </ChartFrame>
        <ChartFrame title="Funding per payday" subtitle="Planned transfers by destination account">
          <BreakdownChart
            points={summary.funding.map((item) => ({
              id: item.destinationId,
              name:
                destinations.find((account) => account.id === item.destinationId)?.name ??
                "Unavailable account",
              value: item.perPayPeriod,
              color: colors.investments,
            }))}
            empty="Choose destination accounts in the budget to see funding amounts."
          />
        </ChartFrame>
      </Box>
    </Box>
  );
}
