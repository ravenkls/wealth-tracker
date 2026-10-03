import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { errorMessage } from "../../lib/data";
import { BreakdownChart } from "../../components/charts/BreakdownChart";
import { TimelineChart } from "../../components/charts/TimelineChart";
import { chartMoney } from "../../components/charts/ChartFrame";
import { colors } from "../../components/charts/chartData";
import { categoryColour } from "./categoryColours";
import { mergeInsights, monthRange } from "./insightsModel";
import { useInsights } from "./useInsights";
export function AnalysisInsights({
  selectedMonth,
  onMonthChange,
}: {
  readonly selectedMonth: string;
  readonly onMonthChange: (month: string) => void;
}) {
  const [showIncoming, setShowIncoming] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState("GBP");
  const range = monthRange(selectedMonth);
  const { query, pages, ready } = useInsights(range);
  const { isFetchNextPageError, fetchNextPage } = query;
  const currencies = [
    ...new Set(pages.flatMap((page) => page.currencies.map((value) => value.currency))),
  ].sort();
  const currency = currencies.includes(selectedCurrency)
    ? selectedCurrency
    : (currencies[0] ?? selectedCurrency);
  const summary = mergeInsights(pages, currency, range);
  const money = (value: number) => chartMoney(value, currency);
  return (
    <Box sx={{ mb: 3 }}>
      <Stack
        direction="row"
        useFlexGap
        sx={{ mb: 2, gap: 1.5, flexWrap: "wrap", alignItems: "center" }}
      >
        <TextField
          label="Month"
          type="month"
          size="small"
          value={selectedMonth}
          slotProps={{ inputLabel: { shrink: true } }}
          onChange={(event) => {
            if (
              /^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value) &&
              Number(event.target.value.slice(0, 4)) >= 1900
            )
              onMonthChange(event.target.value);
          }}
          sx={{ width: 190 }}
        />
        {currencies.length > 1 && (
          <TextField
            select
            size="small"
            label="Currency"
            value={currency}
            onChange={(event) => setSelectedCurrency(event.target.value)}
            sx={{ width: 110 }}
          >
            {currencies.map((item) => (
              <MenuItem key={item} value={item}>
                {item}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>
      {query.isError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button
              onClick={() => {
                if (isFetchNextPageError) void fetchNextPage();
                else void query.refetch();
              }}
            >
              Retry
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ overflow: "hidden" }} aria-busy={!ready && !query.isError}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", md: "repeat(4,minmax(0,1fr))" },
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          {[
            {
              label: "Money in",
              value: money(summary.totals.moneyIn),
              colour: "success.main",
              explanation: "All incoming transactions, including refunds and transfers.",
            },
            {
              label: "Money out",
              value: money(summary.totals.moneyOut),
              colour: "text.primary",
              explanation:
                "All outgoing transactions, including transfers. Sandbox accounts are excluded from these charts.",
            },
            {
              label: "Net flow",
              value: money(summary.totals.moneyIn - summary.totals.moneyOut),
              colour:
                summary.totals.moneyIn >= summary.totals.moneyOut ? "success.main" : "text.primary",
              explanation: "Money in minus money out for the selected currency.",
            },
            {
              label: "Uncategorised outflow",
              value: money(summary.uncategorised),
              colour: "text.primary",
              explanation: "Outgoing transactions without one of your categories.",
            },
          ].map((stat) => (
            <Box key={stat.label} sx={{ p: { xs: 2, sm: 2.5 }, minWidth: 0 }}>
              <Tooltip title={stat.explanation}>
                <Typography sx={{ fontSize: 12, color: "text.secondary", width: "fit-content" }}>
                  {stat.label}
                </Typography>
              </Tooltip>
              {ready ? (
                <Typography
                  sx={{
                    mt: 0.75,
                    fontSize: { xs: 21, sm: 25 },
                    fontWeight: 600,
                    letterSpacing: "-.5px",
                    color: stat.colour,
                    overflowWrap: "anywhere",
                  }}
                >
                  {stat.value}
                </Typography>
              ) : (
                <Skeleton width="75%" height={35} />
              )}
            </Box>
          ))}
        </Box>
        {!ready ? (
          <Box sx={{ p: 3 }}>
            <Typography component="output" sx={{ fontSize: 13, color: "text.secondary" }}>
              {query.isError ? "Analysis could not be loaded." : "Loading monthly analysis…"}
            </Typography>
            <Skeleton variant="rounded" height={280} sx={{ mt: 2 }} />
          </Box>
        ) : !summary.totals.count ? (
          <Box sx={{ p: 3, fontSize: 13, color: "text.secondary" }}>
            No non-sandbox transactions imported for this month.
          </Box>
        ) : (
          <>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "minmax(0,1fr)", lg: "minmax(0,1.2fr) minmax(0,1fr)" },
              }}
            >
              <Box
                component="section"
                aria-label="Daily transaction chart"
                sx={{ p: { xs: 2, sm: 2.5 }, minWidth: 0 }}
              >
                <Stack
                  direction="row"
                  useFlexGap
                  sx={{
                    mb: 2,
                    gap: 1,
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
                    {showIncoming ? "Daily cash flow" : "Daily outgoings"}
                  </Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={showIncoming ? "flow" : "out"}
                    onChange={(_, value: string | null) => {
                      if (value) setShowIncoming(value === "flow");
                    }}
                    aria-label="Daily chart view"
                  >
                    <ToggleButton value="out">Outgoings</ToggleButton>
                    <ToggleButton value="flow">Cash flow</ToggleButton>
                  </ToggleButtonGroup>
                </Stack>
                <TimelineChart
                  formatLabel={(value) => String(value)}
                  currency={currency}
                  showLegend={showIncoming}
                  points={summary.points}
                  series={
                    showIncoming
                      ? [
                          {
                            key: "moneyOut",
                            name: "Money out",
                            color: colors.spending,
                            type: "bar",
                          },
                          { key: "moneyIn", name: "Money in", color: colors.saved, type: "line" },
                        ]
                      : [
                          {
                            key: "moneyOut",
                            name: "Money out",
                            color: colors.spending,
                            type: "bar",
                          },
                        ]
                  }
                />
              </Box>
              <Box
                component="section"
                aria-label="Outgoings by category"
                sx={{
                  p: { xs: 2, sm: 2.5 },
                  borderLeft: { lg: 1 },
                  borderTop: { xs: 1, lg: 0 },
                  borderColor: { xs: "divider", lg: "divider" },
                  minWidth: 0,
                }}
              >
                <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600, mb: 2 }}>
                  Outgoings by category
                </Typography>
                <BreakdownChart
                  currency={currency}
                  points={summary.categories.map((category) => ({
                    id: category.id,
                    name: category.name,
                    value: category.moneyOut,
                    color: categoryColour(category.id),
                  }))}
                  empty="No outgoings in this month."
                />
              </Box>
            </Box>
            <Box
              component="section"
              aria-label="Top merchants"
              sx={{ p: { xs: 2, sm: 2.5 }, borderTop: 1, borderColor: "divider" }}
            >
              <Stack
                direction="row"
                sx={{ justifyContent: "space-between", gap: 2, mb: 2, alignItems: "center" }}
              >
                <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
                  Top merchants
                </Typography>
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  {summary.totals.count.toLocaleString()} transactions
                </Typography>
              </Stack>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "minmax(0,1fr)",
                    sm: "repeat(2,minmax(0,1fr))",
                    lg: "repeat(3,minmax(0,1fr))",
                  },
                  gap: 2,
                }}
              >
                {summary.merchants.slice(0, 6).map((merchant) => (
                  <Box key={merchant.name} sx={{ minWidth: 0 }}>
                    <Stack
                      direction="row"
                      sx={{ justifyContent: "space-between", gap: 1, mb: 0.75 }}
                    >
                      <Typography
                        sx={{
                          fontSize: 13,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={merchant.name}
                      >
                        {merchant.name}
                      </Typography>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                        {money(merchant.moneyOut)}
                      </Typography>
                    </Stack>
                    <Box sx={{ height: 3, bgcolor: "action.hover", borderRadius: 1 }}>
                      <Box
                        sx={{
                          height: "100%",
                          width: `${(merchant.moneyOut / summary.merchants[0]!.moneyOut) * 100}%`,
                          bgcolor: "primary.main",
                          borderRadius: 1,
                        }}
                      />
                    </Box>
                  </Box>
                ))}
              </Box>
              {!summary.merchants.length && (
                <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                  No outgoing merchant transactions.
                </Typography>
              )}
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
}
