import { useState } from "react";
import { Autocomplete, TextField } from "@mui/material";
import { canonicalCategory } from "@wealth/domain";

export function CategoryCell({
  value,
  options,
  label,
  onCommit,
}: {
  readonly value: string | null;
  readonly options: string[];
  readonly label: string;
  readonly onCommit: (value: string | null) => void;
}) {
  const [error, setError] = useState("");
  return (
    <Autocomplete
      freeSolo
      autoSelect
      selectOnFocus
      clearOnBlur={false}
      handleHomeEndKeys
      value={value}
      options={options}
      size="small"
      sx={{
        minWidth: 170,
        "& .MuiInputBase-root": { fontSize: 13, px: 0.75 },
        "&:focus-within": { outline: "1px solid", outlineColor: "primary.main", borderRadius: 0.5 },
        "&:hover": { bgcolor: "action.hover" },
        "& .MuiFormHelperText-root": { whiteSpace: "normal" },
      }}
      onChange={(_, next) => {
        const category = canonicalCategory(next, options);
        if (category && category.length > 100) {
          setError("Use 100 characters or fewer.");
          return;
        }
        setError("");
        if (category !== value) onCommit(category);
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Uncategorised"
          error={!!error}
          helperText={error}
          variant="standard"
          slotProps={{
            ...params.slotProps,
            input: { ...params.slotProps.input, disableUnderline: true },
            htmlInput: {
              ...params.slotProps.htmlInput,
              "aria-label": label,
              title: value ?? "Uncategorised",
            },
          }}
        />
      )}
    />
  );
}
