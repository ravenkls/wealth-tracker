import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  ListItemText,
  Button,
  Popover,
  Stack,
  TextField,
} from "@mui/material";
import { Icon } from "../../components/Icon";
import { errorMessage } from "../../lib/data";
import { categoryColour, categoryPillStyles } from "./categoryColours";
export function CategoryDot({ id }: { readonly id: string | null | undefined }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        bgcolor: categoryColour(id),
        display: "inline-block",
        flexShrink: 0,
        mx: 1,
      }}
    />
  );
}
export function CategoryPill({
  id,
  name,
  label,
  categories,
  disabled,
  onCommit,
  compact = false,
}: {
  readonly id: string | null;
  readonly name: string | null;
  readonly label: string;
  readonly categories: { id: string; name: string }[];
  readonly disabled: boolean;
  readonly onCommit: (categoryId: string | null) => Promise<void>;
  readonly compact?: boolean;
}) {
  const searchInput = useRef<HTMLInputElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = [{ id: null, name: "Uncategorised" }, ...categories].filter((category) =>
    category.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  useEffect(() => {
    if (anchor) searchInput.current?.focus();
  }, [anchor]);
  async function assign(categoryId: string | null) {
    if (busy) return;
    if (categoryId === id) {
      setAnchor(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCommit(categoryId);
      setAnchor(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Chip
        label={name ?? "Uncategorised"}
        icon={busy ? <CircularProgress size={12} color="inherit" /> : <CategoryDot id={id} />}
        deleteIcon={
          busy ? <CircularProgress size={12} color="inherit" /> : <Icon name="down" size={15} />
        }
        onDelete={
          disabled || busy
            ? undefined
            : (event) => {
                setAnchor((event.currentTarget as Element).closest<HTMLElement>(".MuiChip-root"));
                setSearch("");
                setError("");
              }
        }
        onClick={(event) => {
          setAnchor(event.currentTarget);
          setSearch("");
          setError("");
        }}
        disabled={disabled || busy}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        variant="outlined"
        size="small"
        sx={{
          ...categoryPillStyles(id),
          ...(compact ? { height: 24, fontSize: 12, "& .MuiChip-label": { px: 0.75 } } : {}),
        }}
      />
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => {
          if (!busy) setAnchor(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75,
              width: 280,
              maxWidth: "calc(100vw - 32px)",
              border: 1,
              borderColor: "divider",
            },
          },
        }}
      >
        <Stack
          component="dialog"
          open
          aria-label="Choose category"
          sx={{
            p: 1,
            gap: 1,
            position: "static",
            m: 0,
            border: 0,
            width: "100%",
            boxSizing: "border-box",
            bgcolor: "background.paper",
            color: "text.primary",
          }}
        >
          <TextField
            inputRef={searchInput}
            size="small"
            label="Find category"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={busy}
          />
          <Box sx={{ maxHeight: 280, overflowY: "auto" }}>
            {options.map((category) => (
              <Button
                key={category.id ?? "uncategorised"}
                variant="text"
                aria-pressed={category.id === id}
                disabled={busy}
                onClick={() => void assign(category.id)}
                sx={{
                  width: "100%",
                  textAlign: "left",
                  border: 0,
                  borderRadius: 1,
                  whiteSpace: "normal",
                  color: "text.primary",
                  justifyContent: "flex-start",
                  bgcolor: category.id === id ? "action.selected" : undefined,
                }}
              >
                <CategoryDot id={category.id} />
                <ListItemText
                  primary={category.name}
                  slotProps={{ primary: { sx: { fontSize: 13, overflowWrap: "anywhere" } } }}
                />
                {category.id === id && <Icon name="check" size={16} />}
              </Button>
            ))}
            {!options.length && (
              <Box sx={{ p: 1.5, fontSize: 13, color: "text.secondary" }}>
                No matching categories.
              </Box>
            )}
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </Popover>
    </>
  );
}
