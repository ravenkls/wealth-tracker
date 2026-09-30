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
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { api } from "../../lib/api";
import { errorMessage, useRefresh } from "../../lib/data";

export function ConnectEnduteDialog({
  expectedVersion,
  onClose,
  onConnected,
}: {
  readonly expectedVersion: number;
  readonly onClose: () => void;
  readonly onConnected: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const refresh = useRefresh();
  const connect = useMutation({
    mutationFn: () => api.endute.connect.mutate({ apiKey, expectedVersion }),
    onSuccess: async () => {
      setApiKey("");
      await refresh();
      onConnected();
    },
    onError: () => {
      void refresh();
    },
  });
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={connect.isPending ? undefined : onClose}>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          connect.mutate();
        }}
      >
        <DialogTitle>
          {expectedVersion ? "Replace Endute API key" : "Connect Endute Connect"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {connect.isError && <Alert severity="error">{errorMessage(connect.error)}</Alert>}
            <Typography color="text.secondary">
              Link and enable your bank accounts in the{" "}
              <Link href="https://connect.endute.com/" target="_blank" rel="noopener noreferrer">
                Endute portal
              </Link>
              , then create an API key. Paste it here and choose which accounts to track.
            </Typography>
            <TextField
              label="API key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              required
              autoComplete="off"
              size="small"
              slotProps={{ htmlInput: { maxLength: 512 } }}
            />
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              Your key is encrypted on the server. This connection tracks GBP cash, savings, credit
              cards and loans. Investments remain separately tracked.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={connect.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={connect.isPending}>
            {expectedVersion ? "Replace key" : "Connect"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
