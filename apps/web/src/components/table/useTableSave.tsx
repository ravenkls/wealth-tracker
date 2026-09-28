import { useRef, useState } from "react";
import { Alert, Button, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../../lib/data";
export function useTableSave() {
  const client = useQueryClient();
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save(work: () => Promise<unknown>) {
    if (locked.current) throw new Error("Wait for the current save, or reload after the error.");
    locked.current = true;
    setPending(true);
    try {
      await work();
      await client.invalidateQueries({ queryKey: ["wealth"] });
      locked.current = false;
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    } finally {
      setPending(false);
    }
  }
  return {
    save,
    disabled: pending || !!error,
    status: error ? (
      <Alert
        severity="error"
        action={
          <Button color="inherit" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      >
        {error} Your edit has not been confirmed saved.
      </Alert>
    ) : pending ? (
      <Typography component="output" color="text.secondary" sx={{ fontSize: 12 }}>
        Saving…
      </Typography>
    ) : null,
  };
}
