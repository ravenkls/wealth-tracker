import { Box, TextField, Typography } from "@mui/material";
import {
  defaultForecastAssumptions,
  validateForecastAssumptions,
  type ForecastAssumptions,
} from "@wealth/domain";
import { MoneyField, moneyInput, readMoney } from "../../components/Fields";

export type ForecastDraft = Record<keyof ForecastAssumptions, string>;
export function forecastDraft(value = defaultForecastAssumptions): ForecastDraft {
  return {
    spendingLow: moneyInput(value.spendingLow),
    spendingUsual: moneyInput(value.spendingUsual),
    spendingHigh: moneyInput(value.spendingHigh),
    annualGrowth: String(value.annualGrowth * 100),
    annualVolatility: String(value.annualVolatility * 100),
  };
}
export function readForecastDraft(draft: ForecastDraft): ForecastAssumptions {
  if (!draft.annualGrowth.trim() || !draft.annualVolatility.trim())
    throw new Error("Enter forecast growth and volatility.");
  const value = {
    spendingLow: readMoney(draft.spendingLow, "Lowest spending adjustment"),
    spendingUsual: readMoney(draft.spendingUsual, "Usual spending adjustment"),
    spendingHigh: readMoney(draft.spendingHigh, "Highest spending adjustment"),
    annualGrowth: Number(draft.annualGrowth) / 100,
    annualVolatility: Number(draft.annualVolatility) / 100,
  };
  validateForecastAssumptions(value);
  return value;
}
export function ForecastAssumptionsEditor({
  draft,
  onChange,
  disabled,
}: {
  readonly draft: ForecastDraft;
  readonly onChange: (value: ForecastDraft) => void;
  readonly disabled: boolean;
}) {
  return (
    <Box component="fieldset" disabled={disabled} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0,1fr)", md: "3fr 2fr" },
          gap: 3,
        }}
      >
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 550, mb: 2 }}>
            Monthly spending adjustment
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0,1fr)", sm: "repeat(3,minmax(0,1fr))" },
              gap: 2,
            }}
          >
            {(
              [
                ["spendingLow", "Lowest"],
                ["spendingUsual", "Usual"],
                ["spendingHigh", "Highest"],
              ] as const
            ).map(([key, label]) => (
              <MoneyField
                key={key}
                label={`${label} adjustment`}
                value={draft[key]}
                onChange={(value) => onChange({ ...draft, [key]: value })}
              />
            ))}
          </Box>
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>
            Positive means overspending; negative means underspending. £0 follows your budget.
          </Typography>
        </Box>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 550, mb: 2 }}>
            Investment assumptions
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0,1fr)", sm: "repeat(2,minmax(0,1fr))" },
              gap: 2,
            }}
          >
            {(
              [
                ["annualGrowth", "Annual growth (%)"],
                ["annualVolatility", "Annual volatility (%)"],
              ] as const
            ).map(([key, label]) => (
              <TextField
                key={key}
                size="small"
                label={label}
                value={draft[key]}
                onChange={(event) => onChange({ ...draft, [key]: event.target.value })}
                slotProps={{ htmlInput: { inputMode: "decimal" } }}
              />
            ))}
          </Box>
          <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>
            Compound growth and yearly return variation. Cash earns no interest.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
