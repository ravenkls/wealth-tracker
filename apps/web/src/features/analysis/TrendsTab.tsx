import { useState } from "react";
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { month, trackBudget, type BudgetPlan } from "@wealth/domain";
import { TimelineChart } from "../../components/charts/TimelineChart";
import { colors, shortMonth } from "../../components/charts/chartData";
import { compactCurrencyMoney } from "../../components/charts/ChartFrame";
import { categoryColour } from "./categoryColours";
import { CategoryDot } from "./CategoryPill";
import type { Analysis } from "./ledgerModel";
import { trackingStatuses } from "./BudgetTracking";
import { grid, MerchantLink, Muted, Section } from "./parts";

const OTHER = "#5d6673";
const cellMoney = (value: number, currency: string) =>
  value >= 100000
    ? compactCurrencyMoney(value, currency)
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(value / 100);

export function TrendsTab({
  analysis,
  money,
  onCategory,
  plan,
  links,
}: {
  readonly analysis: Analysis;
  readonly money: (value: number) => string;
  readonly onCategory: (id: string) => void;
  readonly plan: BudgetPlan | null;
  readonly links: readonly { id: string; budgetCategory: string | null }[];
}) {
  const [mix, setMix] = useState<"amount" | "share">("amount");
  const months = analysis.months;
  const base = (flow: (typeof months)[number]) => ({
    label: flow.month,
    detail: shortMonth(flow.month),
  });
  const flowPoints = months.map((flow) => ({
    ...base(flow),
    moneyIn: flow.covered ? flow.moneyIn : null,
    moneyOut: flow.covered ? flow.moneyOut : null,
    net: flow.covered ? flow.moneyIn - flow.moneyOut : null,
  }));
  const ratePoints = months.map((flow) => ({
    ...base(flow),
    rate:
      flow.covered && flow.moneyIn > 0
        ? Math.round(((flow.moneyIn - flow.moneyOut) / flow.moneyIn) * 1000) / 10
        : null,
  }));
  const ranked = [...analysis.categories].sort((a, b) => b.total - a.total);
  const shown = ranked.slice(0, 6);
  const rest = ranked.slice(6);
  const mixPoints = months.map((flow) => {
    const point: Record<string, string | number | null> = base(flow);
    const scale = mix === "share" && flow.moneyOut ? 100 / flow.moneyOut : 1;
    for (const category of shown)
      point[category.id] = flow.covered
        ? Math.round((flow.categories.get(category.id) ?? 0) * scale * 10) / 10
        : null;
    if (rest.length)
      point.other = flow.covered
        ? Math.round(
            rest.reduce((sum, category) => sum + (flow.categories.get(category.id) ?? 0), 0) *
              scale *
              10,
          ) / 10
        : null;
    return point as { label: string; detail: string };
  });
  const settled = months.filter((flow) => flow.averaged);
  const averageOut =
    settled.reduce((sum, flow) => sum + flow.moneyOut, 0) / Math.max(1, settled.length);
  return (
    <>
      <Box sx={grid({ lg: "minmax(0,1.4fr) minmax(0,1fr)" })}>
        <Section
          title="Monthly cash flow"
          subtitle={`Average ${money(averageOut)} out a month over ${settled.length} months`}
        >
          <TimelineChart
            currency={analysis.currency}
            points={flowPoints}
            series={[
              { key: "moneyIn", name: "Money in", color: colors.saved, type: "bar" },
              { key: "moneyOut", name: "Money out", color: colors.spending, type: "bar" },
              { key: "net", name: "Net flow", color: "var(--chart-total)", type: "line" },
            ]}
          />
        </Section>
        <Section title="Savings rate" subtitle="Share of money in that wasn't spent each month">
          <TimelineChart
            percent
            points={ratePoints}
            showLegend={false}
            series={[
              { key: "rate", name: "Savings rate", color: colors.investments, type: "line" },
            ]}
            empty="No income recorded in this range."
          />
        </Section>
      </Box>

      <Box sx={{ mb: 2.5 }}>
        <Section
          title="Spending mix"
          subtitle={
            rest.length
              ? `Your six largest categories; ${rest.length} smaller ones are grouped as Other`
              : "Monthly outgoings by category"
          }
          action={
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mix}
              onChange={(_, value: typeof mix | null) => value && setMix(value)}
              aria-label="Spending mix scale"
            >
              <ToggleButton value="amount">Amount</ToggleButton>
              <ToggleButton value="share">Share</ToggleButton>
            </ToggleButtonGroup>
          }
        >
          <TimelineChart
            currency={analysis.currency}
            percent={mix === "share"}
            points={mixPoints}
            series={[
              ...shown.map((category) => ({
                key: category.id,
                name: category.name,
                color: categoryColour(category.id),
                type: "bar" as const,
                stack: "mix",
              })),
              ...(rest.length
                ? [
                    {
                      key: "other",
                      name: "Other",
                      color: OTHER,
                      type: "bar" as const,
                      stack: "mix",
                    },
                  ]
                : []),
            ]}
          />
        </Section>
      </Box>

      <Box sx={{ mb: 2.5 }}>
        <Section
          title="Category heatmap"
          subtitle="Each row is shaded against its own busiest month, so seasonal patterns stand out"
          flush
        >
          <Heatmap analysis={analysis} money={money} onCategory={onCategory} />
        </Section>
      </Box>

      {plan && <BudgetHistory analysis={analysis} plan={plan} links={links} money={money} />}
    </>
  );
}

function Heatmap({
  analysis,
  money,
  onCategory,
}: {
  readonly analysis: Analysis;
  readonly money: (value: number) => string;
  readonly onCategory: (id: string) => void;
}) {
  const theme = useTheme();
  // Columns before the first imported month would only ever be blank.
  const first = Math.max(
    0,
    analysis.months.findIndex((flow) => flow.covered),
  );
  const months = analysis.months.slice(first);
  const rows = [...analysis.categories]
    .filter((category) => category.total > 0)
    .sort((a, b) => b.total - a.total);
  if (!rows.length)
    return (
      <Box sx={{ px: 2.5, pb: 2.5 }}>
        <Muted>No outgoings in this range.</Muted>
      </Box>
    );
  return (
    <TableContainer sx={{ px: { xs: 2, sm: 2.5 }, pb: 1 }}>
      <Table size="small" aria-label="Category spending by month" sx={{ minWidth: 640 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ minWidth: 150 }}>Category</TableCell>
            {months.map((flow) => (
              <TableCell key={flow.month} align="center" sx={{ px: 0.25 }}>
                {shortMonth(flow.month)}
              </TableCell>
            ))}
            <TableCell align="right" sx={{ pl: 1.5 }}>
              Monthly avg
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((category) => {
            const peak = Math.max(...category.series);
            return (
              <TableRow key={category.id}>
                <TableCell sx={{ py: 0.5 }}>
                  <Box sx={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                    <CategoryDot id={category.id} />
                    <Box sx={{ minWidth: 0, ml: -0.5 }}>
                      <MerchantLink name={category.name} onClick={() => onCategory(category.id)} />
                    </Box>
                  </Box>
                </TableCell>
                {category.series.slice(first).map((value, index) => {
                  const covered = months[index]!.covered;
                  return (
                    <Tooltip
                      key={months[index]!.month}
                      title={`${category.name}, ${shortMonth(months[index]!.month)}: ${covered ? money(value) : "no data"}`}
                    >
                      <TableCell
                        align="center"
                        sx={{
                          px: 0.25,
                          py: 0.5,
                          fontSize: 11,
                          border: 0,
                        }}
                      >
                        <Box
                          sx={{
                            borderRadius: 1,
                            py: 0.9,
                            bgcolor: covered
                              ? alpha(
                                  theme.palette.primary.main,
                                  value ? 0.08 + (value / peak) * 0.72 : 0.03,
                                )
                              : "transparent",
                            color:
                              value / peak > 0.55
                                ? theme.palette.primary.contrastText
                                : "text.secondary",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {covered && value
                            ? cellMoney(value, analysis.currency)
                            : covered
                              ? "·"
                              : ""}
                        </Box>
                      </TableCell>
                    </Tooltip>
                  );
                })}
                <TableCell align="right" sx={{ pl: 1.5, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {money(category.monthlyAverage)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function BudgetHistory({
  analysis,
  plan,
  links,
  money,
}: {
  readonly analysis: Analysis;
  readonly plan: BudgetPlan;
  readonly links: readonly { id: string; budgetCategory: string | null }[];
  readonly money: (value: number) => string;
}) {
  const months = analysis.months.filter((flow) => flow.averaged);
  const history = months.map((flow) =>
    trackBudget({
      plan,
      links,
      month: month(flow.month),
      today: analysis.window.asOf,
      spend: flow.categories,
    }),
  );
  const names = history[0]?.categories.filter((category) => category.status !== "unlinked") ?? [];
  if (analysis.currency !== "GBP" || !names.length) return null;
  return (
    <Section
      title="Budget history"
      subtitle="How each linked budget category finished every month"
      flush
    >
      <TableContainer sx={{ px: { xs: 2, sm: 2.5 }, pb: 1 }}>
        <Table size="small" aria-label="Budget results by month" sx={{ minWidth: 640 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 150 }}>Budget</TableCell>
              {months.map((flow) => (
                <TableCell key={flow.month} align="center" sx={{ px: 0.25 }}>
                  {shortMonth(flow.month)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>On-track score</TableCell>
              {history.map((result, index) => (
                <TableCell
                  key={months[index]!.month}
                  align="center"
                  sx={{ px: 0.25, fontWeight: 600 }}
                >
                  {result.score === null ? "—" : `${Math.round(result.score * 100)}%`}
                </TableCell>
              ))}
            </TableRow>
            {names.map((budget) => (
              <TableRow key={budget.name}>
                <TableCell>
                  <Typography sx={{ fontSize: 13 }}>{budget.name}</Typography>
                  <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                    {money(budget.budget)} a month
                  </Typography>
                </TableCell>
                {history.map((result, index) => {
                  const category = result.categories.find((item) => item.name === budget.name)!;
                  const status = trackingStatuses[category.status as keyof typeof trackingStatuses];
                  const used = category.budget ? category.spent / category.budget : 0;
                  return (
                    <Tooltip
                      key={months[index]!.month}
                      title={`${status.label}: ${money(category.spent)} of ${money(category.budget)}`}
                    >
                      <TableCell align="center" sx={{ px: 0.25, py: 0.5, border: 0 }}>
                        <Box
                          sx={{
                            mx: "auto",
                            py: 0.6,
                            borderRadius: 1,
                            fontSize: 11,
                            fontWeight: 600,
                            border: 1,
                            borderColor: `${status.colour}.main`,
                            color: `${status.colour}.main`,
                          }}
                        >
                          {Math.round(used * 100)}%
                        </Box>
                      </TableCell>
                    </Tooltip>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography color="text.secondary" sx={{ fontSize: 11, px: { xs: 2, sm: 2.5 }, pb: 2 }}>
        Percent of each month's budget used. Green finished on track; red went over.
      </Typography>
    </Section>
  );
}
