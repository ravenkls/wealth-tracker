import { useState } from "react";
import {
  Box,
  LinearProgress,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import {
  monthlyChart,
  calculateNetWorth,
  formatGbp,
  formatMonth,
  pence,
  sumMoney,
} from "@wealth/domain";
import { formatSignedGbp } from "../../lib/money";
import { AccountBalances } from "./AccountBalances";
import { NetWorthChart } from "./NetWorthChart";
import type { OverviewData } from "./model";

export function Overview({ data }: { readonly data: OverviewData }) {
  const [range, setRange] = useState<"6M" | "YTD" | "1Y">("1Y");
  const grouped = (category: "cash" | "investments" | "pensions") =>
    data.accounts.filter((account) => account.category === category);
  const totals = calculateNetWorth({
    cash: grouped("cash").map((a) => a.balance),
    investments: grouped("investments").map((a) => a.balance),
    pensions: grouped("pensions").map((a) => a.balance),
  });
  const change = sumMoney(data.accounts.map((account) => account.change));
  const previous = totals.total - change;
  const history = monthlyChart(data.history, range, data.month);
  const savings = pence(data.budget.income - data.budget.spending);
  const categories = [
    ["Cash", "cash", "#a8bec4"],
    ["Investments", "investments", "#91b4f5"],
    ["Pensions", "pensions", "#b3a6ca"],
  ] as const;
  return (
    <>
      <Box
        component="header"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          mb: 4,
          flexWrap: "wrap",
        }}
      >
        <Typography component="h1" sx={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.6px" }}>
          Overview
        </Typography>
        <Typography color="text.secondary" sx={{ fontSize: 13 }}>
          {formatMonth(data.month)}
        </Typography>
      </Box>
      <Paper variant="outlined" sx={{ borderRadius: "12px", px: { xs: 2, sm: 3.75 }, pt: 3.5 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
          <Box>
            <Typography component="h2" color="text.secondary" sx={{ fontSize: 14 }}>
              Net worth
            </Typography>
            <Typography
              sx={{
                fontSize: { xs: 32, sm: 46 },
                lineHeight: 1.3,
                letterSpacing: "-1.6px",
                fontWeight: 550,
                mt: 1,
              }}
            >
              {formatGbp(totals.total)}
            </Typography>
            <Typography sx={{ fontSize: 12, mt: 1 }} color="text.secondary">
              <Box component="span" sx={{ color: "success.main", mr: 1 }}>
                {formatSignedGbp(change)}
                {previous > 0 ? ` (${((change / previous) * 100).toFixed(1)}%)` : ""}
              </Box>
              since {formatMonth(data.previousMonth)}
            </Typography>
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={range}
            onChange={(_, value: "6M" | "YTD" | "1Y" | null) => value && setRange(value)}
            aria-label="Chart range"
            sx={{ alignSelf: "start" }}
          >
            {["6M", "YTD", "1Y"].map((value) => (
              <ToggleButton key={value} value={value}>
                {value}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        <NetWorthChart history={history} />
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3,1fr)" },
            borderTop: 1,
            borderColor: "divider",
            mt: 2,
            py: 3,
            gap: { xs: 2, sm: 3 },
          }}
        >
          {categories.map(([label, key, color], i) => (
            <Box
              key={key}
              sx={{
                borderLeft: { sm: i ? 1 : 0 },
                borderColor: { sm: "divider" },
                pl: { sm: i ? 3 : 0 },
              }}
            >
              <Typography
                sx={{ fontSize: 12, display: "flex", alignItems: "center", gap: 1 }}
                color="text.secondary"
              >
                <Box
                  component="span"
                  sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: color }}
                />
                {label}
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 1,
                  mt: 1,
                  flexWrap: "wrap",
                }}
              >
                <Typography sx={{ fontSize: 22 }}>{formatGbp(totals[key])}</Typography>
                <Typography sx={{ fontSize: 11 }} color="success.main">
                  {formatSignedGbp(sumMoney(grouped(key).map((account) => account.change)))}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Paper>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0,1.65fr) minmax(280px,1fr)" },
          gap: 4,
          mt: 4,
        }}
      >
        <AccountBalances accounts={data.accounts} excludingPensions={totals.excludingPensions} />
        <Box sx={{ borderLeft: { lg: 1 }, borderColor: { lg: "divider" }, pl: { lg: 3.75 } }}>
          <Typography component="h2" sx={{ fontSize: 15, fontWeight: 550, mb: 2.5 }}>
            Monthly budget
          </Typography>
          {[
            ["Income", data.budget.income],
            ["Planned spending", data.budget.spending],
          ].map(([label, value]) => (
            <Box
              key={label}
              sx={{ display: "flex", justifyContent: "space-between", mt: 2, fontSize: 13 }}
            >
              <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                {label}
              </Typography>
              {formatGbp(pence(Number(value)))}
            </Box>
          ))}
          <LinearProgress
            variant="determinate"
            value={
              data.budget.income > 0
                ? Math.min(100, Math.max(0, (data.budget.spending / data.budget.income) * 100))
                : 0
            }
            aria-label="Planned spending as a percentage of income"
            sx={{ mt: 3, "& .MuiLinearProgress-bar": { backgroundColor: "#8c9db6" } }}
          />
          <Box
            sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 2 }}
          >
            <Typography sx={{ fontSize: 13 }}>Available to save</Typography>
            <Typography sx={{ fontSize: 21 }}>{formatGbp(savings)}</Typography>
          </Box>
          <Box sx={{ borderTop: 1, borderColor: "divider", mt: 3.75, pt: 3 }}>
            <Typography component="h2" sx={{ fontSize: 15, fontWeight: 550, mb: 2 }}>
              Cash savings goal
            </Typography>
            <Typography sx={{ fontSize: 23 }}>
              {formatGbp(totals.cash)}{" "}
              <Box component="span" sx={{ fontSize: 13, color: "text.secondary" }}>
                / {formatGbp(data.cashGoal)}
              </Box>
            </Typography>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, Math.max(0, (totals.cash / data.cashGoal) * 100))}
              aria-label="Cash savings goal progress"
              sx={{ mt: 2 }}
            />
            <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1.5 }}>
              {formatGbp(pence(Math.max(0, data.cashGoal - totals.cash)))} to go
            </Typography>
          </Box>
        </Box>
      </Box>
    </>
  );
}
