import { Box, Stack, Typography } from "@mui/material";
import { BreakdownChart } from "../../components/charts/BreakdownChart";
import { TimelineChart } from "../../components/charts/TimelineChart";
import { colors } from "../../components/charts/chartData";
import { compactCurrencyMoney } from "../../components/charts/ChartFrame";
import { spendingPatterns, type Analysis, type unusualTransactions } from "./ledgerModel";
import { grid, Muted, Section } from "./parts";
import { fromLedger, TransactionList } from "./TransactionList";

export function PatternsTab({
  analysis,
  unusual,
  money,
  onMerchant,
}: {
  readonly analysis: Analysis;
  readonly unusual: ReturnType<typeof unusualTransactions>;
  readonly money: (value: number) => string;
  readonly onMerchant: (name: string) => void;
}) {
  const patterns = spendingPatterns(analysis);
  const typical = new Map(unusual.map((item) => [item.entry.key, item.typical]));
  const busiest = [...patterns.weekdays].sort((a, b) => b.average - a.average)[0]!;
  const quietest = [...patterns.weekdays].sort((a, b) => a.average - b.average)[0]!;
  const weekend = (patterns.weekdays[5]!.average + patterns.weekdays[6]!.average) / 2;
  const weekday = patterns.weekdays.slice(0, 5).reduce((sum, day) => sum + day.average, 0) / 5;
  const halves = [
    patterns.monthDays.slice(0, 15).reduce((sum, day) => sum + day.average, 0),
    patterns.monthDays.slice(15).reduce((sum, day) => sum + day.average, 0),
  ];
  const label = (limit: number) => compactCurrencyMoney(limit, analysis.currency);
  const outgoings = analysis.entries.filter((entry) => entry.amount < 0).length;
  return (
    <>
      <Box sx={grid({ lg: "repeat(2,minmax(0,1fr))" })}>
        <Section
          title="Day of the week"
          subtitle={
            weekday
              ? `Average spend per day. ${busiest.label} is your biggest day; weekends run ${Math.round(Math.abs(weekend / weekday - 1) * 100)}% ${weekend >= weekday ? "above" : "below"} weekdays.`
              : "Average spend per day"
          }
        >
          <TimelineChart
            formatLabel={String}
            currency={analysis.currency}
            showLegend={false}
            points={patterns.weekdays}
            series={[
              { key: "average", name: "Average spend", color: colors.spending, type: "bar" },
            ]}
            empty="No outgoings in this range."
          />
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>
            Quietest: {quietest.label} at {money(quietest.average)} a day.
          </Typography>
        </Section>
        <Section
          title="Through the month"
          subtitle={`Average spend on each day of the month. ${Math.round((halves[0]! / Math.max(1, halves[0]! + halves[1]!)) * 100)}% lands in the first half.`}
        >
          <TimelineChart
            formatLabel={String}
            currency={analysis.currency}
            showLegend={false}
            points={patterns.monthDays}
            series={[{ key: "average", name: "Average spend", color: colors.cash, type: "bar" }]}
            empty="No outgoings in this range."
          />
        </Section>
      </Box>
      <Box sx={grid({ lg: "repeat(2,minmax(0,1fr))" })}>
        <Section
          title="Payment sizes"
          subtitle={`Where the money goes by payment size, across ${outgoings.toLocaleString()} outgoings`}
        >
          <BreakdownChart
            currency={analysis.currency}
            points={patterns.bands
              .filter((band) => band.count)
              .map((band) => ({
                id: String(band.limit),
                name: `${band.limit === Infinity ? `${label(band.from)}+` : `${label(band.from)}–${label(band.limit)}`} · ${band.count} payments`,
                value: band.total,
                color: colors.pensions,
              }))}
            empty="No outgoings in this range."
          />
          {!!patterns.bands.length && <SmallSpendNote bands={patterns.bands} money={money} />}
        </Section>
        <Section
          title="Unusual payments"
          subtitle="This month's payments well above what's normal for their category"
        >
          {unusual.length ? (
            <TransactionList
              transactions={unusual.map((item) => fromLedger(item.entry))}
              onMerchant={onMerchant}
              limit={10}
              aside={(entry) => (
                <Typography color="text.secondary" sx={{ fontSize: 11, whiteSpace: "nowrap" }}>
                  usually {money(typical.get(entry.key)!)}
                </Typography>
              )}
            />
          ) : (
            <Muted>Nothing out of the ordinary this month.</Muted>
          )}
        </Section>
      </Box>
    </>
  );
}

function SmallSpendNote({
  bands,
  money,
}: {
  readonly bands: ReturnType<typeof spendingPatterns>["bands"];
  readonly money: (value: number) => string;
}) {
  const small = bands.filter((band) => band.limit <= 2000);
  const count = small.reduce((sum, band) => sum + band.count, 0);
  const total = small.reduce((sum, band) => sum + band.total, 0);
  const all = bands.reduce((sum, band) => sum + band.count, 0);
  if (!count) return null;
  return (
    <Stack sx={{ mt: 1.5 }}>
      <Typography color="text.secondary" sx={{ fontSize: 12 }}>
        Small payments under {money(2000)} make up {Math.round((count / all) * 100)}% of your
        payments but {money(total)} in total.
      </Typography>
    </Stack>
  );
}
