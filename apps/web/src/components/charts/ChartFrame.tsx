import { Box, Paper, Typography } from "@mui/material";
import type { ReactNode } from "react";
export const chartGrid = {
  display: "grid",
  gridTemplateColumns: { xs: "minmax(0,1fr)", lg: "repeat(2,minmax(0,1fr))" },
  gap: 3,
  mb: 3,
};
export function ChartFrame({
  title,
  subtitle,
  action,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Paper
      component="section"
      aria-label={title}
      variant="outlined"
      sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          gap: 2,
          mb: 2,
          minHeight: 56,
          flexWrap: "wrap",
        }}
      >
        <Box>
          <Typography component="h2" sx={{ fontSize: 17, fontWeight: 550 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
      {children}
    </Paper>
  );
}
export function ChartEmpty({ children }: { readonly children: ReactNode }) {
  return (
    <Box sx={{ minHeight: { xs: 120, sm: 220 }, display: "grid", placeItems: "center", px: 2 }}>
      <Typography color="text.secondary" sx={{ fontSize: 13, textAlign: "center", maxWidth: 340 }}>
        {children}
      </Typography>
    </Box>
  );
}
export const tooltipStyle = {
  background: "var(--chart-surface)",
  border: "1px solid var(--chart-border)",
  borderRadius: 7,
  color: "var(--chart-text)",
  fontSize: 12,
  maxWidth: 280,
  boxShadow: "0 8px 24px #0004",
};
export const axisTick = { fill: "var(--chart-muted)", fontSize: 11 };
export const compactMoney = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value / 100);
