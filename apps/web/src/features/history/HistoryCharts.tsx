import { useState } from "react";
import { Box, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { darken } from "@mui/material/styles";
import type { HistoryRange } from "@wealth/domain";
import { ChartFrame, chartGrid } from "../../components/charts/ChartFrame";
import { TimelineChart } from "../../components/charts/TimelineChart";
import { RangeControl } from "../../components/charts/RangeControl";
import { colors, historyPoints } from "../../components/charts/chartData";
import type { AppData } from "../../lib/data";
const components = [
  { key: "cash", name: "Cash", color: colors.cash },
  { key: "investments", name: "Investments", color: colors.investments },
  { key: "pensions", name: "Pensions", color: colors.pensions },
];
export function HistoryCharts({ data }: { readonly data: AppData }) {
  const [range, setRange] = useState<HistoryRange>("1Y"),
    [selected, setSelected] = useState(["cash", "investments", "pensions"]);
  const points = historyPoints(data.snapshots, range, data.currentMonth);
  return (
    <>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <RangeControl value={range} onChange={setRange} />
      </Box>
      <Box sx={chartGrid}>
        <ChartFrame
          title="Balance history"
          action={
            <ToggleButtonGroup
              size="small"
              value={selected}
              aria-label="Balance series"
              onChange={(_, next: string[]) => {
                if (next.length) setSelected(next);
              }}
              sx={{ flexWrap: "wrap" }}
            >
              {components.map((item) => (
                <ToggleButton
                  key={item.key}
                  value={item.key}
                  sx={(theme) => ({
                    "&.Mui-selected": {
                      color: theme.palette.mode === "light" ? darken(item.color, 0.45) : item.color,
                    },
                  })}
                >
                  {item.name}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          }
        >
          <TimelineChart
            points={points}
            series={components
              .filter((item) => selected.includes(item.key))
              .map((item) => ({ ...item, type: "line" }))}
          />
        </ChartFrame>
        <ChartFrame
          title="Change between snapshots"
          subtitle="Compared with the previous saved month, including gaps"
        >
          <TimelineChart
            points={points.map((point) => ({ ...point, detail: String(point.changeDetail) }))}
            series={[
              {
                key: "change",
                name: "Net-worth change",
                type: "bar",
                color: colors.saved,
                signed: true,
              },
            ]}
            empty="Save at least two months to compare changes."
          />
        </ChartFrame>
      </Box>
    </>
  );
}
