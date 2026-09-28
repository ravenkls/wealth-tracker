import { useEffect, useRef, useState } from "react";
import { TextField, MenuItem, InputAdornment } from "@mui/material";
import { errorMessage } from "../../lib/data";

export function EditableCell({
  value,
  label,
  onCommit,
  options,
  disabled = false,
  numeric = false,
  multiline = false,
}: {
  readonly value: string;
  readonly label: string;
  readonly onCommit: (value: string) => Promise<unknown> | void;
  readonly options?: { value: string; label: string }[];
  readonly disabled?: boolean;
  readonly numeric?: boolean;
  readonly multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const focused = useRef(false);
  const edit = useRef({ value, onCommit });
  const busy = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  async function commit(next: string) {
    if (busy.current || next === edit.current.value || disabled) return;
    busy.current = true;
    setError("");
    try {
      await edit.current.onCommit(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      busy.current = false;
    }
  }
  return (
    <TextField
      value={draft}
      size="small"
      variant="standard"
      fullWidth={!numeric}
      multiline={multiline}
      maxRows={multiline ? (editing ? 8 : 2) : undefined}
      disabled={disabled}
      select={!!options}
      error={!!error}
      helperText={error}
      onFocus={() => {
        focused.current = true;
        setEditing(true);
        edit.current = { value, onCommit };
      }}
      onBlur={() => {
        focused.current = false;
        setEditing(false);
        void commit(draft);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        if (options) void commit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !(multiline && event.shiftKey)) {
          event.preventDefault();
          event.currentTarget
            .querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
            ?.blur();
        }
        if (event.key === "Escape") {
          edit.current = { value, onCommit };
          setDraft(value);
          setError("");
        }
      }}
      slotProps={{
        htmlInput: { "aria-label": label, title: draft, inputMode: numeric ? "decimal" : "text" },
        input: {
          disableUnderline: true,
          ...(numeric
            ? { startAdornment: <InputAdornment position="start">£</InputAdornment> }
            : {}),
        },
      }}
      sx={{
        minWidth: numeric ? 120 : options ? 140 : 180,
        ...(numeric ? { width: 150, maxWidth: "100%", ml: "auto" } : {}),
        "& .MuiInputBase-root": { fontSize: 13, px: 0.75 },
        "& .MuiInputAdornment-root p": { fontSize: 13 },
        "& .MuiFormHelperText-root": { whiteSpace: "normal", overflowWrap: "anywhere" },
        "& textarea": { lineHeight: 1.6 },
        "& input": {
          py: 0.7,
          textAlign: numeric ? "right" : "left",
          fontVariantNumeric: "tabular-nums",
        },
        "&:focus-within": { outline: "1px solid", outlineColor: "primary.main", borderRadius: 0.5 },
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {options?.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
