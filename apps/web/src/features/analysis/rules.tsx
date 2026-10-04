import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Icon } from "../../components/Icon";
import { api, backgroundApi } from "../../lib/api";
import { errorMessage } from "../../lib/data";
import { CategoryDot } from "./CategoryPill";
import { categoryPillStyles } from "./categoryColours";

export type Rule = Awaited<ReturnType<typeof api.rules.list.query>>[number];
type Direction = Rule["direction"];
export interface RuleTarget {
  merchant: string;
  description: string | null;
  categoryId: string | null;
  // Set when editing an existing rule.
  direction?: Direction;
  // Whether the transaction the rule was started from is money in or out.
  flow?: "in" | "out";
}
const directionLabels = {
  any: "Money in & out",
  in: "Money in only",
  out: "Money out only",
} as const;
const same = (a: string | null, b: string | null) =>
  (a ?? "").trim().replace(/\s+/g, " ").toLowerCase() ===
  (b ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function useRules() {
  return useQuery({
    queryKey: ["transaction-rules"],
    queryFn: () => backgroundApi.rules.list.query(),
  });
}
// Rules change how every transaction reads, so every derived view refreshes.
function useRuleInvalidation() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ["transaction-rules", "transaction-ledger", "endute-transactions"].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function RuleDialog({
  target,
  categories,
  onClose,
}: {
  readonly target: RuleTarget | null;
  readonly categories: readonly { id: string; name: string }[];
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={!!target} onClose={onClose} fullWidth maxWidth="xs">
      {target && <RuleForm target={target} categories={categories} onClose={onClose} />}
    </Dialog>
  );
}

function RuleForm({
  target,
  categories,
  onClose,
}: {
  readonly target: RuleTarget;
  readonly categories: readonly { id: string; name: string }[];
  readonly onClose: () => void;
}) {
  const rules = useRules();
  const invalidate = useRuleInvalidation();
  const [direction, setDirection] = useState<Direction>(target.direction ?? "any");
  const existing = rules.data?.find(
    (rule) =>
      same(rule.merchant, target.merchant) &&
      same(rule.description, target.description) &&
      rule.direction === direction,
  );
  const [choice, setChoice] = useState<{ type: "category" | "exclude"; categoryId: string } | null>(
    null,
  );
  const initial = existing
    ? {
        type: existing.action.type,
        categoryId:
          existing.action.type === "category"
            ? existing.action.categoryId
            : (target.categoryId ?? categories[0]?.id ?? ""),
      }
    : {
        type: categories.length ? ("category" as const) : ("exclude" as const),
        categoryId: target.categoryId ?? categories[0]?.id ?? "",
      };
  const value = choice ?? initial;
  // Editing a rule onto a different direction moves it rather than leaving a copy behind.
  const original =
    target.direction && target.direction !== direction
      ? rules.data?.find(
          (rule) =>
            same(rule.merchant, target.merchant) &&
            same(rule.description, target.description) &&
            rule.direction === target.direction,
        )
      : undefined;
  const save = useMutation({
    mutationFn: async () => {
      await api.rules.save.mutate({
        merchant: target.merchant,
        description: target.description,
        direction,
        action:
          value.type === "category"
            ? { type: "category", categoryId: value.categoryId }
            : { type: "exclude" },
      });
      if (original)
        await api.rules.delete.mutate({ id: original.id, expectedVersion: original.version });
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <>
      <DialogTitle sx={{ pb: 1 }}>{existing ? "Update rule" : "Create rule"}</DialogTitle>
      <DialogContent>
        <Box
          sx={{
            p: 1.5,
            mb: 2,
            borderRadius: 1.5,
            bgcolor: "var(--app-inset)",
            border: 1,
            borderColor: "divider",
          }}
        >
          <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
            Applies to every transaction from
          </Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>
            {target.merchant}
          </Typography>
          {target.description && (
            <>
              <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 1 }}>
                with the description
              </Typography>
              <Typography sx={{ fontSize: 13, overflowWrap: "anywhere" }}>
                {target.description}
              </Typography>
            </>
          )}
        </Box>
        <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 0.75 }}>Applies to</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={direction}
          onChange={(_, value: Direction | null) => {
            if (value) {
              setDirection(value);
              setChoice(null);
            }
          }}
          aria-label="Applies to"
        >
          {(["any", "in", "out"] as const).map((value) => (
            <ToggleButton key={value} value={value}>
              {directionLabels[value]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {target.flow && (
          <Typography color="text.secondary" sx={{ fontSize: 11, mt: 0.75 }}>
            This transaction is money {target.flow}.
          </Typography>
        )}
        <RadioGroup
          sx={{ mt: 2 }}
          value={value.type}
          onChange={(event) =>
            setChoice({ ...value, type: event.target.value as "category" | "exclude" })
          }
          aria-label="Rule action"
        >
          <FormControlLabel
            value="category"
            disabled={!categories.length}
            control={<Radio size="small" />}
            label="Always categorise as"
          />
          <TextField
            select
            size="small"
            label="Category"
            value={value.categoryId}
            disabled={value.type !== "category" || !categories.length}
            onChange={(event) => setChoice({ type: "category", categoryId: event.target.value })}
            sx={{ ml: 4, mb: 1.5, mt: 0.5 }}
          >
            {categories.map((category) => (
              <MenuItem key={category.id} value={category.id}>
                <Stack direction="row" sx={{ alignItems: "center" }}>
                  <CategoryDot id={category.id} />
                  {category.name}
                </Stack>
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            value="exclude"
            control={<Radio size="small" />}
            label="Always exclude from analysis"
          />
        </RadioGroup>
        <Typography color="text.secondary" sx={{ fontSize: 12, mt: 2 }}>
          Applies to past and future transactions and overrides Gemini. Categories or exclusions you
          set on an individual transaction still win.
        </Typography>
        {existing && (
          <Alert severity="info" sx={{ mt: 2 }}>
            This replaces your existing rule for this match.
          </Alert>
        )}
        {save.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage(save.error)}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          loading={save.isPending}
          disabled={value.type === "category" && !value.categoryId}
          onClick={() => save.mutate()}
        >
          {existing ? "Update rule" : "Create rule"}
        </Button>
      </DialogActions>
    </>
  );
}

export function RulesPanel({
  categories,
}: {
  readonly categories: readonly { id: string; name: string }[];
}) {
  const rules = useRules();
  const invalidate = useRuleInvalidation();
  const [editing, setEditing] = useState<RuleTarget | null>(null);
  const remove = useMutation({
    mutationFn: (rule: Rule) =>
      api.rules.delete.mutate({ id: rule.id, expectedVersion: rule.version }),
    onSuccess: invalidate,
  });
  const name = (id: string) => categories.find((category) => category.id === id)?.name;
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Rules"
      sx={{ mt: 2.5, p: { xs: 2, sm: 2.5 } }}
    >
      <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
        Rules
      </Typography>
      <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5, mb: 2 }}>
        Always categorise or exclude matching transactions. Create one from the ⋮ menu on any
        transaction.
      </Typography>
      {(rules.isError || remove.isError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(remove.error ?? rules.error)}
        </Alert>
      )}
      {rules.isPending ? (
        <Skeleton variant="rounded" height={48} />
      ) : !rules.data?.length ? (
        <Typography color="text.secondary" sx={{ fontSize: 13 }}>
          No rules yet.
        </Typography>
      ) : (
        <Stack component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {rules.data.map((rule) => {
            const category = rule.action.type === "category" ? rule.action.categoryId : null;
            return (
              <Stack
                component="li"
                key={rule.id}
                direction={{ xs: "column", sm: "row" }}
                sx={{
                  gap: 1.5,
                  py: 1.25,
                  alignItems: { sm: "center" },
                  borderTop: 1,
                  borderColor: "divider",
                  "&:first-of-type": { borderTop: 0, pt: 0 },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>
                    {rule.merchant}
                  </Typography>
                  <Typography
                    color="text.secondary"
                    sx={{ fontSize: 12, overflowWrap: "anywhere" }}
                  >
                    {rule.description ? `Description: ${rule.description}` : "Any description"}
                    {rule.direction !== "any" && ` · ${directionLabels[rule.direction]}`}
                  </Typography>
                </Box>
                <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
                  {category ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={<CategoryDot id={category} />}
                      label={name(category) ?? "Deleted category"}
                      sx={categoryPillStyles(category)}
                    />
                  ) : (
                    <Chip size="small" variant="outlined" label="Excluded" />
                  )}
                  <Button
                    size="small"
                    onClick={() =>
                      setEditing({
                        merchant: rule.merchant,
                        description: rule.description,
                        categoryId: category,
                        direction: rule.direction,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <IconButton
                    size="small"
                    aria-label={`Delete rule for ${rule.merchant}`}
                    disabled={remove.isPending && remove.variables.id === rule.id}
                    onClick={() => remove.mutate(rule)}
                  >
                    <Icon name="trash" size={17} />
                  </IconButton>
                </Stack>
              </Stack>
            );
          })}
        </Stack>
      )}
      <RuleDialog target={editing} categories={categories} onClose={() => setEditing(null)} />
    </Paper>
  );
}
