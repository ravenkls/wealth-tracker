import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { monthlyBudgets } from "@wealth/domain";
import { Icon } from "../../components/Icon";
import { PageHeading } from "../../components/PageHeading";
import { chartMoney } from "../../components/charts/ChartFrame";
import { api, backgroundApi } from "../../lib/api";
import { errorMessage, type AppData } from "../../lib/data";
import { BudgetTracking } from "./BudgetTracking";
import { CategoriesPanel, useCategories } from "./CategoriesPanel";
import { CategoriesTab } from "./CategoriesTab";
import { highlights as buildHighlights } from "./highlights";
import {
  analysisWindow,
  buildAnalysis,
  fetchRange,
  shiftMonth,
  unusualTransactions,
  type AnalysisWindow,
  type LedgerEntry,
} from "./ledgerModel";
import { MerchantDrawer } from "./MerchantDrawer";
import { MerchantsTab } from "./MerchantsTab";
import { OverviewTab } from "./OverviewTab";
import { PatternsTab } from "./PatternsTab";
import { recurringPayments } from "./recurring";
import { RecurringTab } from "./RecurringTab";
import { TransactionsTab } from "./TransactionsTab";
import { TrendsTab } from "./TrendsTab";
import { useLedger } from "./useLedger";
import { RulesPanel } from "./rules";

const tabs = [
  ["overview", "Overview"],
  ["trends", "Trends"],
  ["categories", "Categories"],
  ["merchants", "Merchants"],
  ["recurring", "Recurring"],
  ["patterns", "Patterns"],
  ["transactions", "Transactions"],
] as const;
type TabId = (typeof tabs)[number][0];
const histories = [6, 12, 24] as const;
const validMonth = (value: string | null) =>
  !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 1900;

export function AnalysisPage({ data }: { readonly data: AppData }) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const update = (patch: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch))
          if (value === null) next.delete(key);
          else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  const tab: TabId = tabs.some(([id]) => id === params.get("tab"))
    ? (params.get("tab") as TabId)
    : "overview";
  const requested = params.get("month");
  const selectedMonth =
    validMonth(requested) && requested! <= data.currentMonth ? requested! : data.currentMonth;
  const history = histories.find((value) => String(value) === params.get("range")) ?? 12;
  const [today] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [currency, setCurrency] = useState("GBP");
  const [merchant, setMerchant] = useState<string | null>(null);
  const period = useMemo(
    () => analysisWindow(selectedMonth, history, today),
    [selectedMonth, history, today],
  );
  const ledger = useLedger(fetchRange(period));
  // Keep the last complete window on screen while another loads, so charts never mix ranges.
  const [settled, setSettled] = useState<{
    window: AnalysisWindow;
    entries: LedgerEntry[];
  } | null>(null);
  if (ledger.ready && (settled?.entries !== ledger.entries || settled.window !== period))
    setSettled({ window: period, entries: ledger.entries });
  const currencies = useMemo(
    () => [...new Set(settled?.entries.map((entry) => entry.currency))].sort(),
    [settled],
  );
  const activeCurrency = currencies.includes(currency) ? currency : (currencies[0] ?? "GBP");
  const analysis = useMemo(
    () => settled && buildAnalysis(settled.entries, activeCurrency, settled.window),
    [settled, activeCurrency],
  );
  const money = (value: number) => chartMoney(value, activeCurrency);
  const recurring = useMemo(
    () => (analysis ? recurringPayments(analysis.history, analysis.window.asOf) : []),
    [analysis],
  );
  const unusual = useMemo(() => (analysis ? unusualTransactions(analysis) : []), [analysis]);
  const highlights = useMemo(
    () =>
      analysis
        ? buildHighlights(analysis, recurring, unusual, (value) =>
            chartMoney(value, analysis.currency),
          )
        : [],
    [analysis, recurring, unusual],
  );
  const categories = useCategories();
  const links = categories.data?.categories ?? [];
  const plan = data.budget?.plan ?? null;
  const status = useQuery({
    queryKey: ["endute-sync"],
    queryFn: () => backgroundApi.analysis.status.query(),
    refetchInterval: 15000,
  });
  const refresh = useMutation({
    mutationFn: () => api.analysis.refresh.mutate(),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["endute-sync"] }),
        client.invalidateQueries({ queryKey: ["transaction-ledger"] }),
        client.invalidateQueries({ queryKey: ["endute-transactions"] }),
      ]),
  });
  const retryAt = status.data?.retryAt;
  const waiting = status.data?.retrying ?? false;
  const loading = !ledger.ready && !ledger.query.isError;
  const ledgerError = ledger.query.isError ? errorMessage(ledger.query.error) : null;
  const viewing = analysis?.window.month ?? selectedMonth;
  const openCategory = (id: string) => update({ tab: "categories", category: id });
  const panel = (
    <Box sx={{ mt: 2.5 }}>
      <CategoriesPanel budgetCategories={plan ? [...monthlyBudgets(plan).keys()] : []} />
      <RulesPanel categories={links} />
    </Box>
  );
  return (
    <>
      <PageHeading title="Analysis">
        <Button
          variant="outlined"
          startIcon={<Icon name="refresh" />}
          loading={refresh.isPending}
          disabled={waiting || status.data?.syncing}
          onClick={() => refresh.mutate()}
        >
          Refresh transactions
        </Button>
      </PageHeading>
      <Stack spacing={2} sx={{ mb: 2 }}>
        {(status.data?.syncing || status.data?.backfilling) && (
          <Alert severity="info">
            {status.data.syncing
              ? "Transaction sync is running."
              : "Importing older transactions. More history is added every five minutes. You can browse what’s already here."}
          </Alert>
        )}
        {status.data?.error && (
          <Alert severity="warning">
            {status.data.error}
            {waiting && ` Retry after ${new Date(retryAt!).toLocaleTimeString("en-GB")}.`}
          </Alert>
        )}
        {(status.isError || refresh.isError || ledger.query.isError) && (
          <Alert
            severity="error"
            action={
              <Button
                onClick={() => {
                  void status.refetch();
                  if (ledger.query.isFetchNextPageError) void ledger.query.fetchNextPage();
                  else void ledger.query.refetch();
                }}
              >
                Retry
              </Button>
            }
          >
            {ledgerError ?? errorMessage(refresh.error ?? status.error)}
          </Alert>
        )}
      </Stack>

      <Paper
        variant="outlined"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 3,
          mb: 2.5,
          overflow: "hidden",
          bgcolor: "background.paper",
        }}
      >
        <Stack
          direction="row"
          useFlexGap
          sx={{ px: 1.5, pt: 1.5, pb: 1, gap: 1.5, flexWrap: "wrap", alignItems: "center" }}
        >
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
            <IconButton
              size="small"
              aria-label="Previous month"
              onClick={() => update({ month: shiftMonth(selectedMonth, -1) })}
              sx={{ transform: "rotate(180deg)" }}
            >
              <Icon name="chevron" size={17} />
            </IconButton>
            <TextField
              label="Month"
              type="month"
              size="small"
              value={selectedMonth}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: data.currentMonth } }}
              onChange={(event) => {
                if (validMonth(event.target.value) && event.target.value <= data.currentMonth)
                  update({
                    month: event.target.value === data.currentMonth ? null : event.target.value,
                  });
              }}
              sx={{ width: 175 }}
            />
            <IconButton
              size="small"
              aria-label="Next month"
              disabled={selectedMonth >= data.currentMonth}
              onClick={() => {
                const next = shiftMonth(selectedMonth, 1);
                update({ month: next === data.currentMonth ? null : next });
              }}
            >
              <Icon name="chevron" size={17} />
            </IconButton>
          </Stack>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={history}
            aria-label="History length"
            onChange={(_, value: number | null) =>
              value && update({ range: value === 12 ? null : String(value) })
            }
          >
            {histories.map((value) => (
              <ToggleButton key={value} value={value}>
                {value} months
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {currencies.length > 1 && (
            <TextField
              select
              size="small"
              label="Currency"
              value={activeCurrency}
              onChange={(event) => setCurrency(event.target.value)}
              sx={{ width: 110 }}
            >
              {currencies.map((item) => (
                <MenuItem key={item} value={item}>
                  {item}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Box sx={{ flex: 1 }} />
          <Typography component="output" color="text.secondary" sx={{ fontSize: 12 }}>
            {loading
              ? `Loading ${ledger.entries.length.toLocaleString()} transactions…`
              : status.data?.lastSyncedAt
                ? `Updated ${new Date(status.data.lastSyncedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                : "Waiting for your first import"}
          </Typography>
        </Stack>
        <Tabs
          value={tab}
          onChange={(_, value: TabId) => update({ tab: value === "overview" ? null : value })}
          variant="scrollable"
          allowScrollButtonsMobile
          aria-label="Analysis sections"
          sx={{ px: 1, minHeight: 42, "& .MuiTab-root": { minHeight: 42, fontSize: 13, px: 1.75 } }}
        >
          {tabs.map(([id, label]) => (
            <Tab key={id} value={id} label={label} />
          ))}
        </Tabs>
        <LinearProgress
          aria-hidden
          sx={{ height: 2, visibility: loading && settled ? "visible" : "hidden" }}
        />
      </Paper>

      {tab === "transactions" ? (
        <TransactionsTab selectedMonth={selectedMonth} onMerchant={setMerchant} />
      ) : !analysis ? (
        <Paper variant="outlined" sx={{ p: 3 }} aria-busy={loading}>
          <Typography component="output" sx={{ fontSize: 13, color: "text.secondary" }}>
            {ledgerError ? "Analysis could not be loaded." : "Loading your transaction history…"}
          </Typography>
          <Skeleton variant="rounded" height={110} sx={{ mt: 2 }} />
          <Skeleton variant="rounded" height={300} sx={{ mt: 2 }} />
        </Paper>
      ) : !analysis.history.length ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary" sx={{ fontSize: 13 }}>
            No non-sandbox transactions imported for this range yet.
          </Typography>
          {tab === "categories" && panel}
        </Paper>
      ) : (
        <Box
          sx={{ opacity: loading ? 0.6 : 1, transition: "opacity .2s" }}
          aria-busy={loading}
          aria-label={`Analysis for ${viewing}`}
        >
          {tab === "overview" && (
            <OverviewTab
              analysis={analysis}
              recurring={recurring}
              highlights={highlights}
              money={money}
              onCategory={openCategory}
              onMerchant={setMerchant}
              budget={
                analysis.currency === "GBP" && (
                  <BudgetTracking
                    plan={plan}
                    selectedMonth={analysis.window.month}
                    today={today}
                    links={links}
                    spend={analysis.current.categories}
                    error={ledgerError}
                  />
                )
              }
            />
          )}
          {tab === "trends" && (
            <TrendsTab
              analysis={analysis}
              money={money}
              onCategory={openCategory}
              plan={plan}
              links={links}
            />
          )}
          {tab === "categories" && (
            <CategoriesTab
              analysis={analysis}
              selected={params.get("category")}
              onSelect={(id) => update({ category: id })}
              money={money}
              onMerchant={setMerchant}
              plan={plan}
              links={links}
              panel={panel}
            />
          )}
          {tab === "merchants" && (
            <MerchantsTab analysis={analysis} money={money} onMerchant={setMerchant} data={data} />
          )}
          {tab === "recurring" && (
            <RecurringTab
              analysis={analysis}
              recurring={recurring}
              money={money}
              onMerchant={setMerchant}
              data={data}
            />
          )}
          {tab === "patterns" && (
            <PatternsTab
              analysis={analysis}
              unusual={unusual}
              money={money}
              onMerchant={setMerchant}
            />
          )}
        </Box>
      )}
      {analysis && (
        <MerchantDrawer
          analysis={analysis}
          recurring={recurring}
          name={merchant}
          money={money}
          onClose={() => setMerchant(null)}
        />
      )}
    </>
  );
}
