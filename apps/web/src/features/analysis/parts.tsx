import type { ReactNode } from "react";
import { Box, Button, Paper, Skeleton, Stack, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";

export function Sparkline({
  values,
  colour,
  width = 96,
  height = 28,
}: {
  readonly values: readonly (number | null)[];
  readonly colour?: string;
  readonly width?: number;
  readonly height?: number;
}) {
  const theme = useTheme();
  const known = values.filter((value): value is number => value !== null);
  if (known.length < 2) return <Box sx={{ width, height }} />;
  const max = Math.max(...known),
    min = Math.min(0, ...known);
  const x = (index: number) => (index / (values.length - 1)) * (width - 4) + 2;
  const y = (value: number) => height - 3 - ((value - min) / (max - min || 1)) * (height - 6);
  const points = values.flatMap((value, index) =>
    value === null ? [] : [`${x(index).toFixed(1)},${y(value).toFixed(1)}`],
  );
  const lastIndex = values.findLastIndex((value) => value !== null);
  const stroke = colour ?? theme.palette.primary.main;
  return (
    <svg width={width} height={height} aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(lastIndex)} cy={y(values[lastIndex]!)} r={2.75} fill={stroke} />
    </svg>
  );
}

// Arrow + signed percentage so direction never relies on colour alone.
export function Delta({
  value,
  higherIsBetter = false,
  suffix,
}: {
  readonly value: number | null;
  readonly higherIsBetter?: boolean;
  readonly suffix?: string;
}) {
  if (value === null || !Number.isFinite(value))
    return (
      <Typography component="span" sx={{ fontSize: 12, color: "text.secondary" }}>
        No comparison yet
      </Typography>
    );
  const flat = Math.abs(value) < 0.02;
  const good = flat ? null : value > 0 === higherIsBetter;
  return (
    <Typography
      component="span"
      sx={{
        fontSize: 12,
        fontWeight: 600,
        color: good === null ? "text.secondary" : good ? "success.main" : "error.main",
        whiteSpace: "nowrap",
      }}
    >
      {flat ? "→" : value > 0 ? "▲" : "▼"} {Math.abs(Math.round(value * 100))}%
      {suffix && (
        <Typography component="span" sx={{ fontSize: 12, color: "text.secondary", ml: 0.5 }}>
          {suffix}
        </Typography>
      )}
    </Typography>
  );
}

export function StatTile({
  label,
  explanation,
  value,
  footer,
  trend,
  colour,
  loading,
}: {
  readonly label: string;
  readonly explanation: string;
  readonly value: string;
  readonly footer?: ReactNode;
  readonly trend?: readonly (number | null)[];
  readonly colour?: string;
  readonly loading?: boolean;
}) {
  return (
    <Box sx={{ p: { xs: 2, sm: 2.5 }, minWidth: 0 }}>
      <Tooltip title={explanation}>
        <Typography sx={{ fontSize: 12, color: "text.secondary", width: "fit-content" }}>
          {label}
        </Typography>
      </Tooltip>
      {loading ? (
        <Skeleton width="75%" height={35} />
      ) : (
        <Stack direction="row" sx={{ alignItems: "end", justifyContent: "space-between", gap: 1 }}>
          <Typography
            sx={{
              mt: 0.75,
              fontSize: { xs: 20, sm: 24 },
              fontWeight: 600,
              letterSpacing: "-.5px",
              color: colour ?? "text.primary",
              overflowWrap: "anywhere",
            }}
          >
            {value}
          </Typography>
          {trend && <Sparkline values={trend} width={72} height={26} />}
        </Stack>
      )}
      {footer && <Box sx={{ mt: 0.5, minHeight: 18 }}>{footer}</Box>}
    </Box>
  );
}

export function Section({
  title,
  subtitle,
  action,
  children,
  flush = false,
  fill = false,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly flush?: boolean;
  readonly fill?: boolean;
}) {
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label={title}
      sx={{
        minWidth: 0,
        overflow: "hidden",
        ...(fill ? { display: "flex", flexDirection: "column" } : {}),
      }}
    >
      <Stack
        direction="row"
        useFlexGap
        sx={{
          px: { xs: 2, sm: 2.5 },
          pt: { xs: 2, sm: 2.5 },
          pb: flush ? 2 : 0,
          gap: 1.5,
          justifyContent: "space-between",
          alignItems: "start",
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" sx={{ fontSize: 16, fontWeight: 600 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {action}
      </Stack>
      <Box
        sx={{
          ...(flush ? {} : { p: { xs: 2, sm: 2.5 } }),
          ...(fill ? { flex: 1, minHeight: 0, position: "relative" } : {}),
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}

export const grid = (columns: { md?: string; lg?: string }) => ({
  display: "grid",
  gap: 2.5,
  mb: 2.5,
  gridTemplateColumns: {
    xs: "minmax(0,1fr)",
    ...(columns.md ? { md: columns.md } : {}),
    ...(columns.lg ? { lg: columns.lg } : {}),
  },
});

export function Muted({ children }: { readonly children: ReactNode }) {
  return (
    <Typography color="text.secondary" sx={{ fontSize: 13 }}>
      {children}
    </Typography>
  );
}

export function MerchantLink({
  name,
  onClick,
}: {
  readonly name: string;
  readonly onClick: () => void;
}) {
  return (
    <Button
      variant="text"
      onClick={onClick}
      sx={{
        minHeight: 0,
        p: 0,
        fontSize: 13,
        fontWeight: 500,
        color: "text.primary",
        justifyContent: "flex-start",
        maxWidth: "100%",
        textAlign: "left",
        "&:hover": { bgcolor: "transparent", textDecoration: "underline" },
      }}
    >
      <Box
        component="span"
        sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {name}
      </Box>
    </Button>
  );
}

export function ShareBar({ value, colour }: { readonly value: number; readonly colour: string }) {
  return (
    <Box aria-hidden sx={{ height: 4, bgcolor: "action.hover", borderRadius: 1 }}>
      <Box
        sx={{
          height: "100%",
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          bgcolor: colour,
          borderRadius: 1,
        }}
      />
    </Box>
  );
}
