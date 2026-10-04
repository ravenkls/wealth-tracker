import { Alert, Box, Chip, Paper, Skeleton, Stack, Tooltip, Typography } from "@mui/material";
import {
  formatGbp,
  month,
  pence,
  trackBudget,
  type BudgetPlan,
  type TrackedCategory,
} from "@wealth/domain";

export const trackingStatuses = {
  "on-track": { label: "On track", colour: "success" },
  ahead: { label: "Ahead of pace", colour: "warning" },
  over: { label: "Over budget", colour: "error" },
} as const;
export function BudgetTracking({
  plan,
  selectedMonth,
  today,
  links,
  spend,
  error,
}: {
  readonly plan: BudgetPlan | null;
  readonly selectedMonth: string;
  readonly today: string;
  readonly links: readonly { id: string; budgetCategory: string | null }[];
  readonly spend: ReadonlyMap<string, number> | null;
  readonly error: string | null;
}) {
  const track = (values: ReadonlyMap<string, number>) =>
    trackBudget({ plan: plan!, links, month: month(selectedMonth), today, spend: values });
  const draft = plan ? track(new Map()) : null;
  const tracking = plan && spend ? track(spend) : null;
  const ready = !!tracking;
  const unlinked = draft?.categories.filter((category) => category.status === "unlinked") ?? [];
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Budget tracking"
      aria-busy={!!draft?.tracked && !ready && !error}
      sx={{ mb: 3, overflow: "hidden" }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{
          p: { xs: 2, sm: 2.5 },
          gap: 2,
          justifyContent: "space-between",
          alignItems: { sm: "center" },
        }}
      >
        <Box>
          <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
            Budget tracking
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5 }}>
            Spending in your linked categories against this month’s budget.
          </Typography>
        </Box>
        {!!draft?.tracked && (
          <Stack direction="row" sx={{ gap: 3, alignItems: "center" }}>
            <Box>
              <Tooltip title="Share of your linked budget, weighted by size, in categories that are on track.">
                <Typography sx={{ fontSize: 12, color: "text.secondary", width: "fit-content" }}>
                  On-track score
                </Typography>
              </Tooltip>
              {tracking ? (
                <Typography sx={{ fontSize: 25, fontWeight: 600, letterSpacing: "-.5px" }}>
                  {tracking.score === null ? "—" : `${Math.round(tracking.score * 100)}%`}
                </Typography>
              ) : (
                <Skeleton width={70} height={38} />
              )}
              <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                {tracking
                  ? `${tracking.onTrack} of ${tracking.tracked} categories`
                  : `${draft.tracked} linked categories`}
              </Typography>
            </Box>
            <Box>
              <Tooltip title="Outgoings this month in categories not linked to your budget, including uncategorised spending.">
                <Typography sx={{ fontSize: 12, color: "text.secondary", width: "fit-content" }}>
                  Unbudgeted
                </Typography>
              </Tooltip>
              {tracking ? (
                <Typography sx={{ fontSize: 25, fontWeight: 600, letterSpacing: "-.5px" }}>
                  {formatGbp(tracking.unbudgeted)}
                </Typography>
              ) : (
                <Skeleton width={90} height={38} />
              )}
              <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                this month
              </Typography>
            </Box>
          </Stack>
        )}
      </Stack>
      <Box sx={{ borderTop: 1, borderColor: "divider", p: { xs: 2, sm: 2.5 } }}>
        {!draft?.categories.length ? (
          <Typography color="text.secondary" sx={{ fontSize: 13 }}>
            Give your budget’s monthly expenses categories to track spending against them.
          </Typography>
        ) : !draft.tracked ? (
          <Typography color="text.secondary" sx={{ fontSize: 13 }}>
            Link your categories to budget categories using Edit categories on the Categories tab to
            see whether you’re on track.
          </Typography>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0,1fr)", md: "repeat(2,minmax(0,1fr))" },
              gap: 2.5,
            }}
          >
            {(tracking ?? draft).categories
              .filter((category) => category.status !== "unlinked")
              .map((category) =>
                tracking ? (
                  <TrackedRow key={category.name} category={category} />
                ) : (
                  <Skeleton key={category.name} variant="rounded" height={56} />
                ),
              )}
          </Box>
        )}
        {!!draft?.tracked && !!unlinked.length && (
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 2.5 }}>
            Not linked: {unlinked.map((category) => category.name).join(", ")}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
function TrackedRow({ category }: { readonly category: TrackedCategory }) {
  const status = trackingStatuses[category.status as keyof typeof trackingStatuses];
  const remaining = category.budget - category.spent;
  const share = (value: number) =>
    category.budget ? Math.min(100, (value / category.budget) * 100) : value ? 100 : 0;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1, mb: 0.75 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {category.name}
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>
            {formatGbp(category.spent)} of {formatGbp(category.budget)} ·{" "}
            {formatGbp(pence(Math.abs(remaining)))} {remaining >= 0 ? "left" : "over"}
          </Typography>
        </Box>
        <Chip size="small" variant="outlined" color={status.colour} label={status.label} />
      </Stack>
      <Box
        aria-hidden
        sx={{ position: "relative", height: 6, bgcolor: "action.hover", borderRadius: 1 }}
      >
        <Box
          sx={{
            height: "100%",
            width: `${share(category.spent)}%`,
            bgcolor: `${status.colour}.main`,
            borderRadius: 1,
          }}
        />
        <Tooltip title={`Expected by today: ${formatGbp(category.allowance)}`}>
          <Box
            sx={{
              position: "absolute",
              top: -3,
              bottom: -3,
              left: `calc(${share(category.allowance)}% - 1px)`,
              width: 2,
              bgcolor: "text.primary",
              opacity: 0.5,
            }}
          />
        </Tooltip>
      </Box>
    </Box>
  );
}
