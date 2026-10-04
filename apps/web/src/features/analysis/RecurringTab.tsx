import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { DataTable } from "../../components/table/DataTable";
import type { AppData } from "../../lib/data";
import { categoryColour } from "./categoryColours";
import { CategoryDot } from "./CategoryPill";
import type { Analysis } from "./ledgerModel";
import type { RecurringPayment } from "./recurring";
import { formatDate } from "./highlights";
import { MerchantLink, Muted, Section, Sparkline, StatTile } from "./parts";

const statuses = {
  active: { label: "Active", colour: "success" },
  due: { label: "Due", colour: "warning" },
  lapsed: { label: "Stopped?", colour: "default" },
} as const;

export function RecurringTab({
  analysis,
  recurring,
  money,
  onMerchant,
  data,
}: {
  readonly analysis: Analysis;
  readonly recurring: readonly RecurringPayment[];
  readonly money: (value: number) => string;
  readonly onMerchant: (name: string) => void;
  readonly data: AppData;
}) {
  const outgoing = recurring.filter((payment) => payment.direction === "out");
  const live = outgoing.filter((payment) => payment.status !== "lapsed");
  const income = recurring.filter(
    (payment) => payment.direction === "in" && payment.status !== "lapsed",
  );
  const monthly = live.reduce((sum, payment) => sum + payment.monthly, 0);
  const monthlyIncome = income.reduce((sum, payment) => sum + payment.monthly, 0);
  const rises = live.filter(
    (payment) => payment.priceChange && payment.priceChange.to > payment.priceChange.from,
  );
  const usualOut = analysis.baselineAverage?.moneyOut ?? null;
  return (
    <>
      <Paper variant="outlined" sx={{ mb: 2.5, overflow: "hidden" }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", md: "repeat(4,minmax(0,1fr))" },
          }}
        >
          <StatTile
            label="Committed each month"
            explanation="Monthly equivalent of every regular outgoing payment that's still active."
            value={money(monthly)}
            footer={
              <Muted>
                {usualOut
                  ? `${Math.round((monthly / usualOut) * 100)}% of usual spending`
                  : `${live.length} payments`}
              </Muted>
            }
          />
          <StatTile
            label="Committed each year"
            explanation="Annual cost of active regular outgoing payments."
            value={money(monthly * 12)}
            footer={<Muted>{live.length} active regular payments</Muted>}
          />
          <StatTile
            label="Regular income"
            explanation="Monthly equivalent of incoming payments that arrive on a regular schedule, like salary."
            value={money(monthlyIncome)}
            colour="success.main"
            footer={
              <Muted>
                {monthlyIncome
                  ? `${money(monthlyIncome - monthly)} left after commitments`
                  : "None detected"}
              </Muted>
            }
          />
          <StatTile
            label="Price rises"
            explanation="Active regular payments whose latest amount is higher than the one before."
            value={rises.length.toLocaleString()}
            footer={
              <Muted>
                {rises.length
                  ? `+${money(rises.reduce((sum, payment) => sum + payment.annual - (payment.priceChange!.from * payment.annual) / payment.amount, 0))} a year`
                  : "No increases spotted"}
              </Muted>
            }
          />
        </Box>
      </Paper>
      {!recurring.length ? (
        <Section title="Regular payments">
          <Muted>
            No regular payments detected yet. Payments need at least three occurrences on a steady
            schedule with a stable amount; try a longer range.
          </Muted>
        </Section>
      ) : (
        <>
          <DataTable
            id="recurring"
            label="Regular payments"
            data={data}
            rows={[...outgoing, ...income]}
            rowId={(row) => row.key}
            defaultGrouping={["direction"]}
            columns={[
              {
                id: "merchant",
                label: "Payee",
                minWidth: 190,
                value: (row) => row.merchant,
                render: (row) => (
                  <Box sx={{ maxWidth: 240 }}>
                    <MerchantLink name={row.merchant} onClick={() => onMerchant(row.merchant)} />
                    <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                      since {formatDate(row.started, true)} · {row.occurrences.length} payments
                    </Typography>
                  </Box>
                ),
              },
              {
                id: "direction",
                label: "Type",
                groupable: true,
                value: (row) => (row.direction === "out" ? "Outgoing" : "Income"),
              },
              {
                id: "category",
                label: "Category",
                groupable: true,
                minWidth: 140,
                value: (row) => analysis.names.get(row.categoryId) ?? "Uncategorised",
                render: (row) => (
                  <Stack direction="row" sx={{ alignItems: "center" }}>
                    <CategoryDot id={row.categoryId} />
                    {analysis.names.get(row.categoryId) ?? "Uncategorised"}
                  </Stack>
                ),
              },
              { id: "cadence", label: "Every", groupable: true, value: (row) => row.cadenceLabel },
              {
                id: "amount",
                label: "Amount",
                align: "right",
                value: (row) => row.amount,
                render: (row) => (
                  <Box>
                    <Box sx={{ fontWeight: 600 }}>{money(row.amount)}</Box>
                    {row.priceChange && (
                      <Typography
                        sx={{
                          fontSize: 11,
                          color:
                            row.priceChange.to > row.priceChange.from === (row.direction === "out")
                              ? "error.main"
                              : "success.main",
                        }}
                      >
                        {row.priceChange.to > row.priceChange.from ? "▲" : "▼"} was{" "}
                        {money(row.priceChange.from)}
                      </Typography>
                    )}
                  </Box>
                ),
              },
              {
                id: "monthly",
                label: "Per month",
                align: "right",
                value: (row) => row.monthly,
                render: (row) => money(row.monthly),
              },
              {
                id: "annual",
                label: "Per year",
                align: "right",
                value: (row) => row.annual,
                render: (row) => money(row.annual),
              },
              {
                id: "next",
                label: "Next expected",
                align: "right",
                value: (row) => row.next,
                render: (row) => (row.status === "lapsed" ? "—" : formatDate(row.next, true)),
              },
              {
                id: "status",
                label: "Status",
                groupable: true,
                value: (row) => statuses[row.status].label,
                render: (row) => (
                  <Chip
                    size="small"
                    variant="outlined"
                    color={statuses[row.status].colour}
                    label={statuses[row.status].label}
                  />
                ),
              },
              {
                id: "history",
                label: "Amounts",
                sortable: false,
                value: () => null,
                render: (row) => (
                  <Sparkline
                    values={row.occurrences.slice(-12).map((item) => item.amount)}
                    colour={categoryColour(row.categoryId)}
                    width={84}
                    height={22}
                  />
                ),
              },
            ]}
          />
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1.5 }}>
            Detected from steady schedules and amounts. Payments overdue by about half a cycle are
            marked as possibly stopped.
          </Typography>
        </>
      )}
    </>
  );
}
