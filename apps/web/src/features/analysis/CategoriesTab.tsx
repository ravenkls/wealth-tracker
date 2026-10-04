import { useEffect, type ReactNode } from "react";
import { Box, ButtonBase, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { canonicalCategory, monthlyBudgets, type BudgetPlan } from "@wealth/domain";
import { TimelineChart } from "../../components/charts/TimelineChart";
import { colors, shortMonth } from "../../components/charts/chartData";
import { categoryColour } from "./categoryColours";
import { CategoryDot } from "./CategoryPill";
import { categoryKey, merchantKey, type Analysis } from "./ledgerModel";
import { fromLedger, TransactionList } from "./TransactionList";
import { Delta, grid, MerchantLink, Muted, Section, ShareBar, Sparkline, StatTile } from "./parts";

export function CategoriesTab({
  analysis,
  selected,
  onSelect,
  money,
  onMerchant,
  plan,
  links,
  panel,
}: {
  readonly analysis: Analysis;
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
  readonly money: (value: number) => string;
  readonly onMerchant: (name: string) => void;
  readonly plan: BudgetPlan | null;
  readonly links: readonly { id: string; budgetCategory: string | null }[];
  readonly panel: ReactNode;
}) {
  const rows = analysis.categories
    .filter((category) => category.total > 0 || category.spent > 0)
    .sort((a, b) => b.total - a.total);
  const category = rows.find((row) => row.id === selected) ?? rows[0];
  // Pin the default so recategorising doesn't swap the panel to a new largest category.
  useEffect(() => {
    if (category && category.id !== selected) onSelect(category.id);
  }, [category, selected, onSelect]);
  return (
    <>
      {!category ? (
        <Box sx={{ mb: 2.5 }}>
          <Section title="Categories">
            <Muted>No categorised outgoings in this range yet.</Muted>
          </Section>
        </Box>
      ) : (
        <Box sx={grid({ lg: "minmax(260px,320px) minmax(0,1fr)" })}>
          <Section title="Categories" subtitle="Total over the selected range" flush fill>
            <Stack
              component="ul"

              aria-label="Categories"
              sx={{
                listStyle: "none",
                m: 0,
                p: 1,
                pt: 0,
                overflowY: "auto",
                maxHeight: { xs: 420, lg: "none" },
                // On wide screens the detail column sets the height and the list scrolls within it.
                position: { lg: "absolute" },
                inset: { lg: 0 },
              }}
            >
              {rows.map((row) => {
                const active = row.id === category.id;
                return (
                  <li key={row.id}>
                    <ButtonBase
                      aria-pressed={active}
                      onClick={() => onSelect(row.id)}
                      sx={{
                        width: "100%",
                        display: "flex",
                        gap: 1,
                        px: 1.5,
                        py: 1.1,
                        borderRadius: 1.5,
                        textAlign: "left",
                        bgcolor: active ? alpha(categoryColour(row.id), 0.16) : "transparent",
                        "&:hover": { bgcolor: alpha(categoryColour(row.id), 0.1) },
                      }}
                    >
                      <CategoryDot id={row.id} />
                      <Box sx={{ flex: 1, minWidth: 0, ml: -1 }}>
                        <Typography noWrap sx={{ fontSize: 13, fontWeight: active ? 600 : 500 }}>
                          {row.name}
                        </Typography>
                        <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                          {money(row.monthlyAverage)} / month
                        </Typography>
                      </Box>
                      <Sparkline
                        values={row.series.map((value, index) =>
                          analysis.months[index]!.covered ? value : null,
                        )}
                        colour={categoryColour(row.id)}
                        width={64}
                        height={24}
                      />
                    </ButtonBase>
                  </li>
                );
              })}
            </Stack>
          </Section>
          <CategoryDetail
            analysis={analysis}
            category={category}
            money={money}
            onMerchant={onMerchant}
            plan={plan}
            links={links}
          />
        </Box>
      )}
      {panel}
    </>
  );
}

function CategoryDetail({
  analysis,
  category,
  money,
  onMerchant,
  plan,
  links,
}: {
  readonly analysis: Analysis;
  readonly category: Analysis["categories"][number];
  readonly money: (value: number) => string;
  readonly onMerchant: (name: string) => void;
  readonly plan: BudgetPlan | null;
  readonly links: readonly { id: string; budgetCategory: string | null }[];
}) {
  const budgets = plan ? monthlyBudgets(plan) : new Map<string, number>();
  const budgetName = canonicalCategory(
    links.find((link) => link.id === category.id)?.budgetCategory,
    [...budgets.keys()],
  );
  const sharing = budgetName
    ? links.filter(
        (link) => canonicalCategory(link.budgetCategory, [...budgets.keys()]) === budgetName,
      )
    : [];
  // A budget shared by several categories can't be drawn against one of them.
  const budget = budgetName && sharing.length === 1 ? (budgets.get(budgetName) ?? null) : null;
  const points = analysis.months.map((flow, index) => ({
    label: flow.month,
    detail: shortMonth(flow.month),
    spent: flow.covered ? category.series[index]! : null,
    average: flow.covered ? category.monthlyAverage : null,
    ...(budget !== null ? { budget: flow.covered ? budget : null } : {}),
  }));
  const entries = analysis.entries.filter(
    (entry) => entry.amount < 0 && categoryKey(entry) === category.id,
  );
  const merchants = new Map<string, { name: string; total: number; count: number }>();
  for (const entry of entries) {
    const key = merchantKey(entry.merchant);
    const merchant = merchants.get(key) ?? { name: entry.merchant, total: 0, count: 0 };
    merchant.total -= entry.amount;
    merchant.count++;
    merchants.set(key, merchant);
  }
  const topMerchants = [...merchants.values()].sort((a, b) => b.total - a.total);
  const peak = analysis.months.reduce(
    (best, flow, index) => (category.series[index]! > category.series[best]! ? index : best),
    0,
  );
  const monthEntries = analysis.monthEntries
    .filter((entry) => entry.amount < 0 && categoryKey(entry) === category.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Stack spacing={2.5} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          borderTop: `3px solid ${categoryColour(category.id)}`,
          bgcolor: "background.paper",
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", md: "repeat(4,minmax(0,1fr))" },
        }}
      >
        <StatTile
          label="This month"
          explanation="Outgoings in this category during the selected month."
          value={money(category.spent)}
          footer={
            <Delta
              value={category.change}
              suffix={analysis.partial ? "vs usual pace" : "vs 3-month avg"}
            />
          }
        />
        <StatTile
          label="Monthly average"
          explanation="Average monthly outgoings across the months with imported data."
          value={money(category.monthlyAverage)}
          footer={<Muted>Peak {shortMonth(analysis.months[peak]!.month)}</Muted>}
        />
        <StatTile
          label="Share of spending"
          explanation="This category's share of all outgoings in the selected month."
          value={`${Math.round(category.share * 100)}%`}
          footer={
            <Muted>
              {category.count} {category.count === 1 ? "payment" : "payments"} this month
            </Muted>
          }
        />
        <StatTile
          label="Average payment"
          explanation="Average size of a payment in this category across the range."
          value={entries.length ? money(category.total / entries.length) : "—"}
          footer={<Muted>{entries.length} payments in range</Muted>}
        />
      </Box>
      <Section
        title={`${category.name} by month`}
        subtitle={
          budget !== null
            ? `Against your ${money(budget)} ${budgetName} budget`
            : budgetName
              ? `Shares the ${budgetName} budget with ${sharing.length - 1} other ${sharing.length === 2 ? "category" : "categories"}`
              : "Link this category to a budget to see your limit here"
        }
      >
        <TimelineChart
          currency={analysis.currency}
          points={points}
          series={[
            { key: "spent", name: "Spent", color: categoryColour(category.id), type: "bar" },
            { key: "average", name: "Average", color: colors.cash, type: "line", dashed: true },
            ...(budget !== null
              ? [
                  {
                    key: "budget",
                    name: "Budget",
                    color: colors.negative,
                    type: "line" as const,
                    dashed: true,
                  },
                ]
              : []),
          ]}
        />
      </Section>
      <Box sx={{ ...grid({ md: "repeat(2,minmax(0,1fr))" }), mb: 0 }}>
        <Section title="Top merchants" subtitle="Across the selected range">
          {topMerchants.length ? (
            <Stack spacing={1.5}>
              {topMerchants.slice(0, 8).map((merchant) => (
                <Box key={merchant.name}>
                  <Stack direction="row" sx={{ gap: 1, mb: 0.5, alignItems: "center" }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <MerchantLink
                        name={merchant.name}
                        onClick={() => onMerchant(merchant.name)}
                      />
                    </Box>
                    <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                      {merchant.count}×
                    </Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                      {money(merchant.total)}
                    </Typography>
                  </Stack>
                  <ShareBar
                    value={merchant.total / topMerchants[0]!.total}
                    colour={categoryColour(category.id)}
                  />
                </Box>
              ))}
            </Stack>
          ) : (
            <Muted>No payments in this category.</Muted>
          )}
        </Section>
        <Section
          title="This month"
          subtitle={`${monthEntries.length} ${monthEntries.length === 1 ? "payment" : "payments"}`}
        >
          <TransactionList transactions={monthEntries.map(fromLedger)} onMerchant={onMerchant} />
        </Section>
      </Box>
    </Stack>
  );
}
