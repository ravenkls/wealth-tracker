import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { api, backgroundApi } from "../../lib/api";
import { errorMessage } from "../../lib/data";

export function useCategories() {
  return useQuery({
    queryKey: ["purchase-categories"],
    queryFn: () => backgroundApi.categories.status.query(),
    refetchInterval: 30000,
  });
}
export function CategoriesPanel() {
  const status = useCategories();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<{ id: string; name: string; description: string }[]>([]);
  async function invalidate() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["purchase-categories"] }),
      client.invalidateQueries({ queryKey: ["endute-transactions"] }),
    ]);
  }
  const save = useMutation({
    mutationFn: (recategorise: boolean) =>
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
  return (
    <Stack spacing={1.5} sx={{ mb: 3 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Typography sx={{ fontWeight: 600, mr: 1 }}>Your categories</Typography>
        <Button
          variant="outlined"
          disabled={!value}
          onClick={() => {
            setDraft(value!.categories.map((c) => ({ ...c })));
            setVersion(value!.version);
            save.reset();
            setOpen(true);
          }}
        >
          {value?.categories.length ? "Manage categories" : "Create categories"}
        </Button>
        <Button
          disabled={!value?.categories.length || value.rebuilding || rebuild.isPending}
          onClick={() => {
            rebuild.reset();
            setConfirm(true);
          }}
        >
          Recategorise all
        </Button>
      </Stack>
      {!value?.categories.length && (
        <Typography color="text.secondary" sx={{ fontSize: 13 }}>
          Create categories and describe what belongs in each. Existing history and new transactions
          will then be categorised automatically.
        </Typography>
      )}
      {!!value?.categories.length && (
        <Typography color="text.secondary" sx={{ fontSize: 13 }}>
          {value.categories.length} categories · {value.moreQueued ? "At least " : ""}
          {value.queued} queued · {value.processing} processing.
          {value.rebuilding && " Preparing history for recategorisation."} Gemini batches may take
          up to 24 hours or longer. Manual category choices are preserved.
        </Typography>
      )}
      {value && !value.configured && (
        <Alert severity="info">
          Automatic categorisation is waiting for the server Gemini API key. You can manage
          categories and assign them manually.
        </Alert>
      )}
      {value?.error && <Alert severity="warning">{value.error}</Alert>}
      {status.isError && <Alert severity="error">{errorMessage(status.error)}</Alert>}
      <Dialog
        open={open}
        onClose={() => {
          if (!save.isPending) setOpen(false);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Purchase categories</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 3, fontSize: 13 }}>
            Names and descriptions guide Gemini. Be specific about overlaps, refunds and transfers.
            Results that do not fit a category remain Uncategorised.
          </Typography>
          <Stack spacing={3}>
            {draft.map((category, index) => (
              <Stack key={category.id} spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <TextField
                    label={`Category ${index + 1}`}
                    value={category.name}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 80 } }}
                    onChange={(e) =>
                      setDraft((previous) =>
                        previous.map((c) =>
                          c.id === category.id ? { ...c, name: e.target.value } : c,
                        ),
                      )
                    }
                  />
                  <Button
                    color="error"
                    aria-label={`Remove category ${index + 1}`}
                    onClick={() =>
                      setDraft((previous) => previous.filter((c) => c.id !== category.id))
                    }
                  >
                    Remove
                  </Button>
                </Stack>
                <TextField
                  label={`Instructions for category ${index + 1}`}
                  value={category.description}
                  size="small"
                  multiline
                  minRows={2}
                  placeholder="For example: supermarket purchases; exclude restaurants and takeaways."
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                  onChange={(e) =>
                    setDraft((previous) =>
                      previous.map((c) =>
                        c.id === category.id ? { ...c, description: e.target.value } : c,
                      ),
                    )
                  }
                />
              </Stack>
            ))}
            <Button
              variant="outlined"
              disabled={draft.length >= 50 || save.isPending}
              onClick={() =>
                setDraft((previous) => [
                  ...previous,
                  { id: crypto.randomUUID(), name: "", description: "" },
                ])
              }
            >
              Add category
            </Button>
            {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 3, pb: 2 }}>
          <Button disabled={save.isPending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(false)}>
            Save
          </Button>
          <Button
            variant="contained"
            loading={save.isPending}
            disabled={!draft.length}
            onClick={() => save.mutate(true)}
          >
            Save and recategorise all
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
      >
        <DialogTitle>Recategorise all transactions?</DialogTitle>
        <DialogContent>
          <Typography>
            Queue your full imported history using the current categories. Existing labels stay
            visible while Gemini processes the batches. Manual choices are preserved.
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
    </Stack>
  );
}
