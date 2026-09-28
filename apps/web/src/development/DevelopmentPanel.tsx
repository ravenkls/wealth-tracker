import { useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { api } from "../lib/api";

type Health = { api: "ready"; database: "ready" | "unavailable" };
export default function DevelopmentPanel({
  preview,
  onTogglePreview,
}: {
  readonly preview: boolean;
  readonly onTogglePreview: () => void;
}) {
  const [health, setHealth] = useState<Health | "loading" | "unavailable">("loading");
  async function check() {
    setHealth("loading");
    try {
      setHealth(await api.health.query());
    } catch {
      setHealth("unavailable");
    }
  }
  useEffect(() => {
    let active = true;
    void api.health
      .query()
      .then((result) => {
        if (active) setHealth(result);
      })
      .catch(() => {
        if (active) setHealth("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Box
      component="aside"
      aria-label="Local development tools"
      sx={{ mt: 5, pt: 2, borderTop: 1, borderColor: "divider" }}
    >
      <Box
        component="details"
        open={
          preview ||
          health === "unavailable" ||
          (typeof health === "object" && health.database === "unavailable")
            ? true
            : undefined
        }
      >
        <Box
          component="summary"
          sx={{
            cursor: "pointer",
            fontSize: 12,
            color: "text.secondary",
            py: 1,
            width: "fit-content",
          }}
        >
          Local development
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, pt: 1 }}>
          <Typography component="output" aria-live="polite" sx={{ fontSize: 12 }}>
            {health === "loading"
              ? "Checking API…"
              : health === "unavailable"
                ? "API unavailable"
                : `API ready: DynamoDB ${health.database}`}
          </Typography>
          <Button size="small" onClick={() => void check()} disabled={health === "loading"}>
            Check connection
          </Button>
          <Button size="small" onClick={onTogglePreview}>
            {preview ? "Hide sample data" : "Show sample data"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
