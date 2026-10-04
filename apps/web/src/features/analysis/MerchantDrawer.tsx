import { Box, Chip, Drawer, IconButton, Stack, Typography } from "@mui/material";
import { TimelineChart } from "../../components/charts/TimelineChart";
import { shortMonth } from "../../components/charts/chartData";
import { Icon } from "../../components/Icon";
import { categoryColour } from "./categoryColours";
import { CategoryDot } from "./CategoryPill";
import { merchantKey, type Analysis } from "./ledgerModel";
import type { RecurringPayment } from "./recurring";
import { formatDate } from "./highlights";
import { Muted } from "./parts";
import { fromLedger, TransactionList } from "./TransactionList";

export function MerchantDrawer({
  analysis,
  recurring,
  name,
  money,
  onClose,
}: {
  readonly analysis: Analysis;
  readonly recurring: readonly RecurringPayment[];
  readonly name: string | null;
  readonly money: (value: number) => string;
  readonly onClose: () => void;
}) {
  const key = name ? merchantKey(name) : null;
  const merchant = analysis.merchants.find((item) => item.key === key);
  const entries = analysis.entries
    .filter((entry) => merchantKey(entry.merchant) === key)
    .sort((a, b) => b.date.localeCompare(a.date));
  const refunds = entries
    .filter((entry) => entry.amount > 0)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const regular = recurring.filter((payment) => merchantKey(payment.merchant) === key);
  return (
    <Drawer
      anchor="right"
      open={!!name}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 480 }, p: { xs: 2, sm: 3 } } } }}
    >
      <Box sx={{ flexShrink: 0 }}>
        <Stack
          direction="row"
          sx={{ alignItems: "start", justifyContent: "space-between", gap: 2, mb: 2 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              component="h2"
              sx={{ fontSize: 20, fontWeight: 600, overflowWrap: "anywhere" }}
            >
              {merchant?.name ?? name}
            </Typography>
            {merchant && (
              <Stack direction="row" sx={{ alignItems: "center", mt: 0.5 }}>
                <CategoryDot id={merchant.categoryId} />
                <Typography color="text.secondary" sx={{ fontSize: 12, ml: -0.5 }}>
                  {analysis.names.get(merchant.categoryId) ?? "Uncategorised"} · since{" "}
                  {formatDate(merchant.first, true)}
                </Typography>
              </Stack>
            )}
          </Box>
          <IconButton onClick={onClose} aria-label="Close merchant details">
            <Icon name="close" />
          </IconButton>
        </Stack>
        {!merchant ? (
          <Muted>No outgoing payments to this merchant in the selected range.</Muted>
        ) : (
          <>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                gap: 2,
                mb: 2.5,
                "& p:first-of-type": { fontSize: 11, color: "text.secondary" },
              }}
            >
              {[
                ["Total", money(merchant.total)],
                ["Payments", merchant.count.toLocaleString()],
                ["Average", money(merchant.average)],
                ["This month", money(merchant.spent)],
                [
                  "Months active",
                  `${merchant.monthCount} of ${analysis.months.filter((flow) => flow.covered).length}`,
                ],
                ["Refunds", money(refunds)],
              ].map(([label, value]) => (
                <Box key={label}>
                  <Typography>{label}</Typography>
                  <Typography sx={{ fontSize: 16, fontWeight: 600 }}>{value}</Typography>
                </Box>
              ))}
            </Box>
            {!!regular.length && (
              <Stack direction="row" useFlexGap sx={{ gap: 1, mb: 2, flexWrap: "wrap" }}>
                {regular.map((payment) => (
                  <Chip
                    key={payment.key}
                    size="small"
                    variant="outlined"
                    color={payment.status === "lapsed" ? "default" : "primary"}
                    label={`${payment.cadenceLabel} ${money(payment.amount)}${payment.status === "lapsed" ? " · stopped" : ` · next ${formatDate(payment.next)}`}`}
                  />
                ))}
              </Stack>
            )}
            <TimelineChart
              currency={analysis.currency}
              showLegend={false}
              points={analysis.months.map((flow, index) => ({
                label: flow.month,
                detail: shortMonth(flow.month),
                spent: flow.covered ? merchant.series[index]! : null,
              }))}
              series={[
                {
                  key: "spent",
                  name: "Spent",
                  color: categoryColour(merchant.categoryId),
                  type: "bar",
                },
              ]}
            />
          </>
        )}
        <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, mt: 3, mb: 1.5 }}>
          Transactions ({entries.length})
        </Typography>
        <TransactionList transactions={entries.map(fromLedger)} limit={60} showYear />
      </Box>
    </Drawer>
  );
}
