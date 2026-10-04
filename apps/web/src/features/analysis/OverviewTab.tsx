import type { ReactNode } from "react";
import { useState } from "react";
import {
  Box,
  Button,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { TimelineChart } from "../../components/charts/TimelineChart";
import { colors } from "../../components/charts/chartData";
import { categoryColour } from "./categoryColours";
import { CategoryDot } from "./CategoryPill";
import { change, type Analysis } from "./ledgerModel";
import type { RecurringPayment } from "./recurring";
import { formatDate, type Highlight } from "./highlights";
import { Delta, EntryList, grid, MerchantLink, Muted, Section, ShareBar, StatTile } from "./parts";

const tones = {
  good: { glyph: "✓", colour: "success.main" },
  bad: { glyph: "!", colour: "error.main" },
  neutral: { glyph: "•", colour: "primary.main" },
} as const;

export function OverviewTab({
  analysis,
  recurring,
  highlights,
  money,
  onCategory,
  onMerchant,
  budget,
}: {
  readonly analysis: Analysis;
  readonly recurring: readonly RecurringPayment[];
  readonly highlights: readonly Highlight[];
  readonly money: (value: number) => string;
  readonly onCategory: (id: string) => void;
  readonly onMerchant: (name: string) => void;
  readonly budget: ReactNode;
}) {
  const { current, comparison, partial, elapsed, baselineAverage } = analysis;
  const versus = partial ? `vs typical by day ${elapsed}` : "vs 3-month avg";
  const covered = analysis.months.map((month) => (month.covered ? month : null));
  const rate = (flow: { moneyIn: number; moneyOut: number }) =>
    flow.moneyIn > 0 ? (flow.moneyIn - flow.moneyOut) / flow.moneyIn : null;
  const rates = covered.map((month) => (month ? rate(month) : null));
  const knownRates = rates.slice(0, -1).filter((value): value is number => value !== null);
  const averageRate = knownRates.length
    ? knownRates.reduce((sum, value) => sum + value, 0) / knownRates.length
    : null;
  const currentRate = rate(current);
  const uncategorised = current.categories.get("uncategorised") ?? 0;
  const projected =
    partial && comparison && baselineAverage
      ? current.moneyOut + Math.max(0, baselineAverage.moneyOut - comparison.moneyOut)
      : null;
  return (
    <>
      <Paper variant="outlined" sx={{ mb: 2.5, overflow: "hidden" }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2,minmax(0,1fr))",
              md: "repeat(3,minmax(0,1fr))",
              xl: "repeat(6,minmax(0,1fr))",
            },
            "& > *": { borderColor: "divider" },
          }}
        >
          <StatTile
            label="Money out"
            explanation="All outgoing transactions, including transfers you haven't excluded."
            value={money(current.moneyOut)}
            trend={covered.map((month) => month?.moneyOut ?? null)}
            footer={
              <Delta
                value={comparison && change(current.moneyOut, comparison.moneyOut)}
                suffix={versus}
              />
            }
          />
          <StatTile
            label="Money in"
            explanation="All incoming transactions, including refunds and transfers."
            value={money(current.moneyIn)}
            colour="success.main"
            trend={covered.map((month) => month?.moneyIn ?? null)}
            footer={
              comparison && !comparison.moneyIn ? (
                <Muted>Usually nothing {partial ? "by now" : "in a month"}</Muted>
              ) : (
                <Delta
                  higherIsBetter
                  value={comparison && change(current.moneyIn, comparison.moneyIn)}
                  suffix={versus}
                />
              )
            }
          />
          <StatTile
            label="Net flow"
            explanation="Money in minus money out."
            value={money(current.moneyIn - current.moneyOut)}
            colour={current.moneyIn >= current.moneyOut ? "success.main" : "error.main"}
            trend={covered.map((month) => (month ? month.moneyIn - month.moneyOut : null))}
            footer={
              baselineAverage && (
                <Muted>
                  Avg {money(baselineAverage.moneyIn - baselineAverage.moneyOut)} a month
                </Muted>
              )
            }
          />
          <StatTile
            label="Savings rate"
            explanation="Share of money in that wasn't spent. Transfers between your own accounts count on both sides."
            value={currentRate === null ? "—" : `${Math.round(currentRate * 100)}%`}
            trend={rates}
            footer={
              averageRate !== null && (
                <Muted>Avg {Math.round(averageRate * 100)}% before this month</Muted>
              )
            }
          />
          {projected !== null ? (
            <StatTile
              label="Projected spend"
              explanation="Spending so far plus what you usually spend in the rest of the month."
              value={money(projected)}
              footer={
                baselineAverage && <Muted>Usual month {money(baselineAverage.moneyOut)}</Muted>
              }
            />
          ) : (
            <StatTile
              label="Average day"
              explanation="Money out divided by the days in the month."
              value={money(current.moneyOut / elapsed)}
              footer={<Muted>{current.count.toLocaleString()} transactions</Muted>}
            />
          )}
          <StatTile
            label="Uncategorised"
            explanation="Outgoings without one of your categories."
            value={money(uncategorised)}
            footer={
              <Muted>
                {current.moneyOut ? Math.round((uncategorised / current.moneyOut) * 100) : 0}% of
                spending
              </Muted>
            }
          />
        </Box>
      </Paper>

      {!!highlights.length && (
        <Paper
          variant="outlined"
          component="section"
          aria-label="Highlights"
          sx={{ mb: 2.5, p: { xs: 2, sm: 2.5 } }}
        >
          <Typography component="h2" sx={{ fontSize: 16, fontWeight: 600, mb: 2 }}>
            Highlights
          </Typography>
          <Box
            component="ul"
            sx={{
              m: 0,
              p: 0,
              listStyle: "none",
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "minmax(0,1fr)",
                sm: "repeat(2,minmax(0,1fr))",
                lg: "repeat(4,minmax(0,1fr))",
              },
            }}
          >
            {highlights.slice(0, 8).map((item) => (
              <Stack component="li" key={item.id} direction="row" sx={{ gap: 1.25, minWidth: 0 }}>
                <Box
                  aria-hidden
                  sx={{
                    color: tones[item.tone].colour,
                    fontSize: 11,
                    lineHeight: "20px",
                    width: 14,
                    flexShrink: 0,
                    textAlign: "center",
                  }}
                >
                  {tones[item.tone].glyph}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{item.title}</Typography>
                  <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.25 }}>
                    {item.detail}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Box>
        </Paper>
      )}

      <Box sx={grid({ lg: "minmax(0,1.25fr) minmax(0,1fr)" })}>
        <PaceChart analysis={analysis} />
        <Section
          title="Spending by category"
          subtitle={`This month ${versus.replace("vs ", "compared with ")}`}
        >
          <CategoryList analysis={analysis} money={money} onCategory={onCategory} />
        </Section>
      </Box>

      {budget}

      <Box sx={grid({ md: "repeat(2,minmax(0,1fr))" })}>
        <Section title="Top merchants" subtitle="Where most of this month's money went">
          <TopMerchants analysis={analysis} money={money} onMerchant={onMerchant} />
        </Section>
        {analysis.partial ? (
          <Section title="Coming up" subtitle="Regular payments expected in the next 30 days">
            <Upcoming
              analysis={analysis}
              recurring={recurring}
              money={money}
              onMerchant={onMerchant}
            />
          </Section>
        ) : (
          <Section title="Largest payments" subtitle="Biggest outgoings this month">
            <EntryList
              entries={[...analysis.monthEntries]
                .filter((entry) => entry.amount < 0)
                .sort((a, b) => a.amount - b.amount)}
              currency={analysis.currency}
              names={analysis.names}
              onMerchant={onMerchant}
              limit={6}
            />
          </Section>
        )}
      </Box>
    </>
  );
}

function PaceChart({ analysis }: { readonly analysis: Analysis }) {
  const [view, setView] = useState<"pace" | "daily" | "flow">("pace");
  const typical = !!analysis.baselineMonths;
  return (
    <Section
      title={
        view === "pace" ? "Spending pace" : view === "daily" ? "Daily outgoings" : "Daily cash flow"
      }
      subtitle={
        view === "pace"
          ? typical
            ? `Cumulative spending against a typical month (average of the previous ${analysis.baselineMonths})`
            : "Cumulative spending through the month"
          : "Per day across the month"
      }
      action={
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={(_, value: typeof view | null) => value && setView(value)}
          aria-label="Daily chart view"
        >
          <ToggleButton value="pace">Pace</ToggleButton>
          <ToggleButton value="daily">Daily</ToggleButton>
          <ToggleButton value="flow">Cash flow</ToggleButton>
        </ToggleButtonGroup>
      }
    >
      <TimelineChart
        formatLabel={String}
        currency={analysis.currency}
        points={analysis.days}
        showLegend={view !== "daily"}
        empty="No transactions in this month."
        series={
          view === "pace"
            ? [
                { key: "cumulativeOut", name: "This month", color: colors.spending, type: "line" },
                ...(typical
                  ? [
                      {
                        key: "typicalOut",
                        name: "Typical month",
                        color: colors.cash,
                        type: "line" as const,
                        dashed: true,
                      },
                    ]
                  : []),
              ]
            : view === "daily"
              ? [{ key: "moneyOut", name: "Money out", color: colors.spending, type: "bar" }]
              : [
                  { key: "moneyOut", name: "Money out", color: colors.spending, type: "bar" },
                  { key: "moneyIn", name: "Money in", color: colors.saved, type: "bar" },
                ]
        }
      />
    </Section>
  );
}

function CategoryList({
  analysis,
  money,
  onCategory,
}: {
  readonly analysis: Analysis;
  readonly money: (value: number) => string;
  readonly onCategory: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = analysis.categories.filter((category) => category.spent > 0 || category.baseline);
  if (!rows.length) return <Muted>No outgoings this month.</Muted>;
  const top = Math.max(...rows.map((category) => Math.max(category.spent, category.baseline ?? 0)));
  return (
    <>
      <Stack spacing={1.75}>
        {rows.slice(0, expanded ? undefined : 7).map((category) => (
          <Box key={category.id}>
            <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 0.5 }}>
              <CategoryDot id={category.id} />
              <Box sx={{ flex: 1, minWidth: 0, ml: -1 }}>
                <MerchantLink name={category.name} onClick={() => onCategory(category.id)} />
              </Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                {money(category.spent)}
              </Typography>
            </Stack>
            <Box sx={{ position: "relative" }}>
              <ShareBar value={category.spent / top} colour={categoryColour(category.id)} />
              {category.baseline !== null && category.baseline > 0 && (
                <Box
                  aria-hidden
                  sx={{
                    position: "absolute",
                    top: -3,
                    bottom: -3,
                    left: `calc(${(category.baseline / top) * 100}% - 1px)`,
                    width: 2,
                    bgcolor: "text.primary",
                    opacity: 0.45,
                  }}
                />
              )}
            </Box>
            <Stack direction="row" sx={{ justifyContent: "space-between", mt: 0.5, gap: 1 }}>
              <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                {Math.round(category.share * 100)}% of spending · {category.count}{" "}
                {category.count === 1 ? "payment" : "payments"}
              </Typography>
              {category.baseline !== null && (
                <Typography color="text.secondary" sx={{ fontSize: 11, whiteSpace: "nowrap" }}>
                  usual {money(category.baseline)} <Delta value={category.change} />
                </Typography>
              )}
            </Stack>
          </Box>
        ))}
      </Stack>
      {rows.length > 7 && (
        <Button
          size="small"
          sx={{ mt: 1.5 }}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? "Show fewer" : `Show all ${rows.length}`}
        </Button>
      )}
      <Typography color="text.secondary" sx={{ fontSize: 11, mt: 1.5 }}>
        The marker shows your usual spend by this point in the month.
      </Typography>
    </>
  );
}

function TopMerchants({
  analysis,
  money,
  onMerchant,
}: {
  readonly analysis: Analysis;
  readonly money: (value: number) => string;
  readonly onMerchant: (name: string) => void;
}) {
  const rows = analysis.merchants
    .filter((merchant) => merchant.spent > 0)
    .sort((a, b) => b.spent - a.spent);
  if (!rows.length) return <Muted>No outgoing merchant transactions.</Muted>;
  return (
    <Stack spacing={1.5}>
      {rows.slice(0, 8).map((merchant) => (
        <Box key={merchant.key}>
          <Stack direction="row" sx={{ gap: 1, alignItems: "center", mb: 0.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <MerchantLink name={merchant.name} onClick={() => onMerchant(merchant.name)} />
            </Box>
            {merchant.isNew && (
              <Typography
                sx={{ fontSize: 10, fontWeight: 600, color: "primary.main", letterSpacing: ".4px" }}
              >
                NEW
              </Typography>
            )}
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{money(merchant.spent)}</Typography>
          </Stack>
          <ShareBar
            value={merchant.spent / rows[0]!.spent}
            colour={categoryColour(merchant.categoryId)}
          />
        </Box>
      ))}
    </Stack>
  );
}

function Upcoming({
  analysis,
  recurring,
  money,
  onMerchant,
}: {
  readonly analysis: Analysis;
  readonly recurring: readonly RecurringPayment[];
  readonly money: (value: number) => string;
  readonly onMerchant: (name: string) => void;
}) {
  const until = new Date(Date.parse(`${analysis.window.asOf}T00:00:00Z`) + 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const rows = recurring
    .filter((payment) => payment.status !== "lapsed" && payment.next <= until)
    .sort((a, b) => a.next.localeCompare(b.next));
  if (!rows.length) return <Muted>No regular payments detected in the next 30 days.</Muted>;
  const total = rows
    .filter((payment) => payment.direction === "out")
    .reduce((sum, payment) => sum + payment.amount, 0);
  return (
    <>
      <Stack spacing={1.25}>
        {rows.slice(0, 8).map((payment) => (
          <Stack key={payment.key} direction="row" sx={{ gap: 1.5, alignItems: "center" }}>
            <Typography sx={{ fontSize: 12, color: "text.secondary", width: 48, flexShrink: 0 }}>
              {payment.next < analysis.window.asOf ? "Due" : formatDate(payment.next)}
            </Typography>
            <CategoryDot id={payment.categoryId} />
            <Box sx={{ flex: 1, minWidth: 0, ml: -1 }}>
              <MerchantLink name={payment.merchant} onClick={() => onMerchant(payment.merchant)} />
            </Box>
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 600,
                color: payment.direction === "in" ? "success.main" : "text.primary",
              }}
            >
              {payment.direction === "in" ? "+" : ""}
              {money(payment.amount)}
            </Typography>
          </Stack>
        ))}
      </Stack>
      <Typography color="text.secondary" sx={{ fontSize: 12, mt: 2 }}>
        {money(total)} of regular outgoings expected by {formatDate(until)}.
      </Typography>
    </>
  );
}
