import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import type { HistoryRange } from "@wealth/domain";
export function RangeControl({
  value,
  onChange,
}: {
  readonly value: HistoryRange;
  readonly onChange: (value: HistoryRange) => void;
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_, next: HistoryRange | null) => next && onChange(next)}
      aria-label="Chart range"
    >
      {(["6M", "YTD", "1Y", "All"] as const).map((range) => (
        <ToggleButton key={range} value={range}>
          {range}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
