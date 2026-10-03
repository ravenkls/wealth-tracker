import { CategoryDot } from "./CategoryPill";
import { categoryPillStyles } from "./categoryColours";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Icon } from "../../components/Icon";
import { api, backgroundApi } from "../../lib/api";
import { errorMessage } from "../../lib/data";

export function useCategories() {
  return useQuery({
    queryKey: ["purchase-categories"],
    queryFn: () => backgroundApi.categories.status.query(),
    refetchInterval: 30000,
  });
}
type DraftCategory = { id: string; name: string; budgetCategory: string | null };
export function CategoriesPanel({
  budgetCategories,
}: {
  readonly budgetCategories: readonly string[];
}) {
  const status = useCategories();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [recategorise, setRecategorise] = useState(false);
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<DraftCategory[]>([]);
  async function invalidate() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["purchase-categories"] }),
      client.invalidateQueries({ queryKey: ["transaction-insights"] }),
      client.invalidateQueries({ queryKey: ["endute-transactions"] }),
    ]);
  }
  const save = useMutation({
    mutationFn: () =>
      api.categories.save.mutate({ categories: draft, expectedVersion: version, recategorise }),
    onSuccess: async () => {
      setOpen(false);
      await invalidate();
    },
  });
  const rebuild = useMutation({
    mutationFn: () => api.categories.recategorise.mutate({ expectedVersion: status.data!.version }),
    onSuccess: async () => {
      setConfirm(false);
      await invalidate();
    },
  });
  const value = status.data;
  const active = !!value && (value.rebuilding || value.queued > 0 || value.processing > 0);
  const names = draft.map((c) => c.name.trim().toLowerCase());
  const valid = names.every(Boolean) && new Set(names).size === names.length;
  const stateLabel = !value
    ? "Loading categorisation"
    : !value.categories.length
      ? "Ready when you are"
      : !value.configured
        ? "Automation unavailable"
        : value.error
          ? "Needs attention"
          : value.uncertain
            ? "Checking batch status"
            : value.rebuilding
              ? "Preparing your history"
              : active
                ? "Categorising transactions"
                : "All caught up";
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Purchase categories"
      sx={{ mb: 3, overflow: "hidden" }}
    >
      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack
          direction="row"
          useFlexGap
          sx={{
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1,
            mb: 1.5,
          }}
        >
          <Box>
            <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
              Your categories
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            disabled={!value}
            onClick={() => {
              setDraft(
                value!.categories.map(({ id, name, budgetCategory }) => ({
                  id,
                  name,
                  budgetCategory,
                })),
              );
              setVersion(value!.version);
              setRecategorise(false);
              save.reset();
              setOpen(true);
            }}
          >
            {value?.categories.length ? "Edit categories" : "Create categories"}
          </Button>
        </Stack>
        {status.isPending ? (
          <Skeleton width="70%" height={32} />
        ) : value?.categories.length ? (
          <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: "wrap" }}>
            {value.categories.slice(0, expanded ? undefined : 8).map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                icon={<CategoryDot id={category.id} />}
                size="small"
                variant="outlined"
                sx={categoryPillStyles(category.id)}
              />
            ))}
            {value.categories.length > 8 && (
              <Button
                size="small"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                sx={{ minHeight: 30, py: 0 }}
              >
                {expanded ? "Show fewer" : `+${value.categories.length - 8} more`}
              </Button>
            )}
          </Stack>
        ) : (
          <Typography color="text.secondary" sx={{ fontSize: 13, maxWidth: 600 }}>
            Add categories to automatically organise your history and new transactions. Anything
            that doesn’t fit stays Uncategorised.
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "var(--app-inset)",
          px: { xs: 2, sm: 2.5 },
          py: 2,
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          sx={{ gap: 2, alignItems: { md: "center" } }}
        >
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
              <Box
                sx={{
                  color: value?.error ? "warning.main" : active ? "primary.main" : "success.main",
                  display: "flex",
                }}
              >
                <Icon name={active ? "history" : "check"} size={18} />
              </Box>
              <Typography component="output" sx={{ fontWeight: 600, fontSize: 13 }}>
                {stateLabel}
              </Typography>
            </Stack>
            {active && (
              <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.75 }}>
                Batch processing can take up to 24 hours or longer.
              </Typography>
            )}
          </Box>
          {!!value?.categories.length && (
            <Stack
              direction="row"
              sx={{ gap: { xs: 2, sm: 3 }, alignItems: "center", flexWrap: "wrap" }}
            >
              <Box>
                <Typography sx={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2 }}>
                  {value.moreQueued
                    ? `${value.queued.toLocaleString()}+`
                    : value.queued.toLocaleString()}
                </Typography>
                <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                  Waiting
                </Typography>
              </Box>
              <Box>
                <Typography
                  sx={{
                    fontSize: 20,
                    fontWeight: 600,
                    lineHeight: 1.2,
                    color: value.processing ? "primary.main" : "text.primary",
                  }}
                >
                  {value.processing.toLocaleString()}
                </Typography>
                <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                  Processing
                </Typography>
              </Box>
              <Button
                size="small"
                disabled={value.rebuilding || rebuild.isPending}
                onClick={() => {
                  rebuild.reset();
                  setConfirm(true);
                }}
              >
                Recategorise all
              </Button>
            </Stack>
          )}
        </Stack>
        {value && !value.configured && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Automatic categorisation is unavailable. You can still assign categories manually.
          </Alert>
        )}
        {value?.error && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {value.error}
          </Alert>
        )}
        {status.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage(status.error)}
          </Alert>
        )}
      </Box>
      <Dialog
        open={open}
        onClose={() => {
          if (!save.isPending) setOpen(false);
        }}
        fullWidth
        maxWidth="md"
        aria-labelledby="category-dialog-title"
      >
        <DialogTitle id="category-dialog-title">Your categories</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mb: 2 }}>
            {draft.map((category, index) => (
              <Stack key={category.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <CategoryDot id={category.id} />
                <TextField
                  label={`Category ${index + 1}`}
                  value={category.name}
                  fullWidth
                  size="small"
                  disabled={save.isPending}
                  slotProps={{ htmlInput: { maxLength: 80 } }}
                  error={!!category.name.trim() && names.indexOf(names[index]!) !== index}
                  helperText={
                    !!category.name.trim() && names.indexOf(names[index]!) !== index
                      ? "Use a unique name"
                      : undefined
                  }
                  onChange={(e) =>
                    setDraft((previous) =>
                      previous.map((c) =>
                        c.id === category.id ? { ...c, name: e.target.value } : c,
                      ),
                    )
                  }
                />
                <TextField
                  select
                  label="Budget category"
                  size="small"
                  value={category.budgetCategory ?? ""}
                  disabled={save.isPending}
                  onChange={(e) =>
                    setDraft((previous) =>
                      previous.map((c) =>
                        c.id === category.id ? { ...c, budgetCategory: e.target.value || null } : c,
                      ),
                    )
                  }
                  sx={{ width: 190, flexShrink: 0 }}
                >
                  <MenuItem value="">
                    <em>Not budgeted</em>
                  </MenuItem>
                  {budgetCategories.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                  {category.budgetCategory &&
                    !budgetCategories.some(
                      (name) => name.toLowerCase() === category.budgetCategory!.toLowerCase(),
                    ) && (
                      <MenuItem value={category.budgetCategory}>
                        {category.budgetCategory} (not in budget)
                      </MenuItem>
                    )}
                </TextField>
                <IconButton
                  disabled={save.isPending}
                  aria-label={`Remove category ${index + 1}`}
                  onClick={() => {
                    if (draft.length === 1) setRecategorise(false);
                    setDraft((previous) => previous.filter((c) => c.id !== category.id));
                  }}
                >
                  <Icon name="close" size={18} />
                </IconButton>
              </Stack>
            ))}
            {!draft.length && (
              <Typography color="text.secondary" sx={{ py: 2, fontSize: 13 }}>
                No categories yet. Add your first below.
              </Typography>
            )}
          </Stack>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Button
              variant="outlined"
              startIcon={<Icon name="plus" />}
              disabled={draft.length >= 50 || save.isPending}
              onClick={() =>
                setDraft((previous) => [
                  ...previous,
                  { id: crypto.randomUUID(), name: "", budgetCategory: null },
                ])
              }
            >
              Add category
            </Button>
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>
              {draft.length} / 50
            </Typography>
          </Stack>
          {save.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errorMessage(save.error)}
            </Alert>
          )}
        </DialogContent>
        <Box sx={{ px: 3, pb: 2 }}>
          {version === 0 ? (
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              Your existing history will be categorised automatically.
            </Typography>
          ) : (
            <>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={recategorise}
                    disabled={!draft.length || save.isPending}
                    onChange={(e) => setRecategorise(e.target.checked)}
                  />
                }
                label={
                  <Typography sx={{ fontSize: 13 }}>Recategorise existing transactions</Typography>
                }
              />
              <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                Existing labels stay visible while processing. Manual choices are preserved.
              </Typography>
            </>
          )}
        </Box>
        <DialogActions>
          <Button disabled={save.isPending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            loading={save.isPending}
            disabled={!valid || (recategorise && !draft.length)}
            onClick={() => save.mutate()}
          >
            Save categories
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={confirm}
        onClose={() => {
          if (!rebuild.isPending) setConfirm(false);
        }}
        fullWidth
        maxWidth="xs"
        aria-labelledby="recategorise-dialog-title"
      >
        <DialogTitle id="recategorise-dialog-title">Recategorise all transactions?</DialogTitle>
        <DialogContent>
          <Typography>
            Use your current category names for your full imported history. Existing labels stay
            visible while processing, and manual choices are preserved.
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 2, fontSize: 13 }}>
            Batch processing can take up to 24 hours or longer.
          </Typography>
          {rebuild.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errorMessage(rebuild.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={rebuild.isPending} onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="contained" loading={rebuild.isPending} onClick={() => rebuild.mutate()}>
            Recategorise all
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
