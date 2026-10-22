import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import type { ManualAccount } from "@wealth/domain";
import { api } from "../../lib/api";
import { errorMessage, useRefresh } from "../../lib/data";

export function RenameAccountDialog({
  account,
  onClose,
}: {
  readonly account: ManualAccount;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(account.name);
  const refresh = useRefresh();
  const rename = useMutation({
    mutationFn: () =>
      api.accounts.rename.mutate({ id: account.id, name, expectedVersion: account.version }),
    onSuccess: () => {
      void refresh();
      onClose();
    },
  });
  return (
    <Dialog open onClose={rename.isPending ? undefined : onClose} fullWidth maxWidth="xs">
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          rename.mutate();
        }}
      >
        <DialogTitle>Rename account</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {rename.isError && <Alert severity="error">{errorMessage(rename.error)}</Alert>}
            <TextField
              label="Display name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              helperText="Refreshes keep this name instead of the provider's."
              size="small"
              fullWidth
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={rename.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={rename.isPending}>
            Save name
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
