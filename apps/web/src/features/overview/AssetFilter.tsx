import { Checkbox, FormControl, InputLabel, ListItemText, MenuItem, Select } from "@mui/material";
import { allAssets, assetOptions, selectedAssets } from "./assetSelection";
import type { AssetKind } from "./assetSelection";

export function AssetFilter({
  value,
  onChange,
}: {
  readonly value: AssetKind[];
  readonly onChange: (value: AssetKind[]) => void;
}) {
  return (
    <FormControl size="small" sx={{ width: { xs: "100%", sm: 300 } }}>
      <InputLabel id="overview-assets-label">Net-worth assets</InputLabel>
      <Select
        multiple
        labelId="overview-assets-label"
        label="Net-worth assets"
        value={value}
        onChange={(event) => {
          const next =
            typeof event.target.value === "string"
              ? event.target.value.split(",")
              : event.target.value;
          const valid = allAssets.filter((asset) => next.includes(asset));
          if (valid.length) onChange(valid);
        }}
        renderValue={(selected) =>
          selected.length === allAssets.length
            ? "All assets"
            : selectedAssets(selected)
                .map((asset) => asset.label)
                .join(", ")
        }
      >
        {assetOptions.map((asset) => (
          <MenuItem
            key={asset.key}
            value={asset.key}
            disabled={value.length === 1 && value.includes(asset.key)}
          >
            <Checkbox checked={value.includes(asset.key)} size="small" />
            <ListItemText primary={asset.label} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
