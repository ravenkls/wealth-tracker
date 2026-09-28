import { InputAdornment, TextField } from "@mui/material";
import { parseGbp } from "@wealth/domain";
import type { Pence } from "@wealth/domain";
export function MoneyField({
  label,
  value,
  onChange,
  required = false,
  helperText,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly required?: boolean;
  readonly helperText?: string;
}) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      size="small"
      fullWidth
      {...(helperText ? { helperText } : {})}
      slotProps={{
        input: { startAdornment: <InputAdornment position="start">£</InputAdornment> },
        htmlInput: { inputMode: "decimal" },
      }}
    />
  );
}
export function moneyInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : (value / 100).toFixed(2);
}
export function readMoney(value: string, label: string): Pence {
  try {
    return parseGbp(value);
  } catch {
    throw new Error(`${label}: enter an amount with up to two decimal places.`);
  }
}
export function nullableMoney(value: string, label: string): Pence | null {
  return value.trim() === "" ? null : readMoney(value, label);
}
