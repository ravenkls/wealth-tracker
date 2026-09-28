import { selectedAssets } from "./assetSelection";
import type { AssetKind } from "./assetSelection";
import { Box, LinearProgress, Typography } from "@mui/material";
import { formatGbp } from "@wealth/domain";
import type { HistoryRange } from "@wealth/domain";
import { BreakdownChart } from "../../components/charts/BreakdownChart";
import { ChartFrame, ChartEmpty, chartGrid } from "../../components/charts/ChartFrame";
import { colors, savingsPoints } from "../../components/charts/chartData";
import { TimelineChart } from "../../components/charts/TimelineChart";
import type { AppData } from "../../lib/data";
export function OverviewCharts({
  data,
  range,
  assets,
}: {
  readonly data: AppData;
  readonly range: HistoryRange;
  readonly assets: readonly AssetKind[];
}) {
  const latest = data.snapshots.at(-1);
  if (!latest) return null;
  const points = savingsPoints(data, range),
    yearRate = data.projections?.yearRate;
  const available = points.some((point) => point.saved !== null);
  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={chartGrid}>
        <ChartFrame title="Asset mix" subtitle="Latest recorded snapshot">
          <BreakdownChart
            kind="donut"
            points={selectedAssets(assets).map((asset) => ({
              id: asset.key,
              name: asset.label,
              value: latest[asset.field],
              color: colors[asset.key],
            }))}
          />
        </ChartFrame>
        <ChartFrame
          title="Savings this year"
          subtitle={data.currentMonth.slice(0, 4) + " completed intervals, excluding pensions"}
        >
          {data.projections?.yearSaved == null ? (
            <ChartEmpty>
              Record balance readings with confirmed income and complete investment history to see
              savings.
            </ChartEmpty>
          ) : (
            <>
              <Typography sx={{ fontSize: 42, letterSpacing: "-1px", mt: 3 }}>
                {yearRate === null || yearRate === undefined
                  ? "—"
                  : (yearRate * 100).toFixed(1) + "%"}
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                Income-weighted savings rate
              </Typography>
              {yearRate !== null && yearRate !== undefined && (
                <LinearProgress
                  variant="determinate"
                  value={Math.max(0, Math.min(100, yearRate * 100))}
                  aria-label="Savings rate this year"
                  sx={{
                    my: 3,
                    height: 8,
                    borderRadius: 1,
                    "& .MuiLinearProgress-bar": {
                      bgcolor: yearRate < 0 ? colors.negative : colors.saved,
                    },
                  }}
                />
              )}
              <Typography sx={{ mt: 3, fontSize: 22 }}>
                {data.projections?.yearSaved === null || data.projections?.yearSaved === undefined
                  ? "—"
                  : formatGbp(data.projections.yearSaved)}{" "}
                <Box component="span" sx={{ fontSize: 13, color: "text.secondary" }}>
                  saved
                </Box>
              </Typography>
              {(yearRate === null || yearRate === undefined) && (
                <Typography color="text.secondary" sx={{ mt: 2, fontSize: 13 }}>
                  No positive-income intervals recorded this year.
                </Typography>
              )}
            </>
          )}
        </ChartFrame>
      </Box>
      {available ? (
        <Box sx={chartGrid}>
          <ChartFrame
            title="Saved between readings"
            subtitle="Actual capture intervals, shown in the ending snapshot month"
          >
            <TimelineChart
              points={points}
              series={[
                { key: "saved", name: "Saved", color: colors.saved, type: "bar", signed: true },
              ]}
            />
          </ChartFrame>
          <ChartFrame
            title="Savings rate"
            subtitle="Savings as a share of income in each capture interval"
          >
            <TimelineChart
              points={points}
              percent
              series={[
                { key: "rate", name: "Savings rate", color: colors.investments, type: "line" },
              ]}
              empty="No positive-income intervals in this range."
            />
          </ChartFrame>
        </Box>
      ) : null}
    </Box>
  );
}
