import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Routes, Route, Navigate, useLocation } from "react-router";
import { useAppData } from "../lib/data";
const LiveOverview = lazy(() =>
  import("../features/overview/LiveOverview").then((module) => ({ default: module.LiveOverview })),
);
const AccountsPage = lazy(() =>
  import("../features/accounts/AccountsPage").then((module) => ({ default: module.AccountsPage })),
);
const BudgetPage = lazy(() =>
  import("../features/budget/BudgetPage").then((module) => ({ default: module.BudgetPage })),
);
const AnalysisPage = lazy(() =>
  import("../features/analysis/AnalysisPage").then((module) => ({ default: module.AnalysisPage })),
);
const HistoryPage = lazy(() =>
  import("../features/history/HistoryPage").then((module) => ({ default: module.HistoryPage })),
);
const SnapshotDialog = lazy(() =>
  import("../features/snapshots/SnapshotDialog").then((module) => ({
    default: module.SnapshotDialog,
  })),
);
import { useHistoryRefresh } from "../features/connections/useHistoryRefresh";
import type { AppData } from "../lib/data";
import { AppShell } from "./AppShell";
import { api } from "../lib/api";
const Preview = import.meta.env.DEV ? lazy(() => import("../development/Preview")) : null;
const DevelopmentPanel = import.meta.env.DEV
  ? lazy(() => import("../development/DevelopmentPanel"))
  : null;
export function App() {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.session.query(),
    refetchOnWindowFocus: true,
  });
  const { pathname } = useLocation();
  const priorPath = useRef(pathname);
  useEffect(() => {
    if (priorPath.current !== pathname) {
      priorPath.current = pathname;
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    }
  }, [pathname, queryClient]);
  const [preview, setPreview] = useState(false),
    [recordOpen, setRecordOpen] = useState(false),
    [error, setError] = useState("");
  async function logout() {
    try {
      const response = await fetch("/auth/logout", { method: "POST" });
      if (response.status !== 204) throw new Error();
      queryClient.clear();
      setPreview(false);
      await session.refetch();
    } catch {
      setError("Sign-out failed. Try again.");
    }
  }
  if (session.isPending)
    return (
      <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <CircularProgress aria-label="Checking session" />
      </Box>
    );
  if (!session.data && !preview)
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3 }}>
        <Box sx={{ width: "100%", maxWidth: 400 }}>
          <Typography component="h1" sx={{ fontSize: 32, fontWeight: 600, mb: 1 }}>
            Wealth.
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 4 }}>
            Your accounts, budget and net worth.
          </Typography>
          {(session.isError || new URLSearchParams(location.search).has("authError")) && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {session.isError
                ? "Could not reach the app. Check the connection and retry."
                : "Google sign-in could not be completed. Please try again."}
            </Alert>
          )}
          <Button variant="contained" fullWidth href="/auth/google">
            Sign in with Google
          </Button>
          {session.isError && (
            <Button onClick={() => void session.refetch()} sx={{ mt: 1 }}>
              Retry connection
            </Button>
          )}
          <Suspense>
            {DevelopmentPanel && (
              <DevelopmentPanel preview={false} onTogglePreview={() => setPreview(true)} />
            )}
          </Suspense>
        </Box>
      </Box>
    );
  return (
    <AppShell
      preview={preview}
      onRecord={() => setRecordOpen(true)}
      {...(session.data ? { user: session.data, onLogout: () => void logout() } : {})}
    >
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <Suspense fallback={<CircularProgress aria-label="Loading overview" />}>
        {preview && Preview ? (
          <Preview recordOpen={recordOpen} onClose={() => setRecordOpen(false)} />
        ) : (
          <LiveApp
            recordOpen={recordOpen}
            onRecord={() => setRecordOpen(true)}
            onClose={() => setRecordOpen(false)}
          />
        )}
        {DevelopmentPanel && (
          <DevelopmentPanel
            preview={preview}
            onTogglePreview={() => {
              setPreview((value) => !value);
              setRecordOpen(false);
            }}
          />
        )}
      </Suspense>
    </AppShell>
  );
}

function LiveApp({
  recordOpen,
  onRecord,
  onClose,
}: {
  readonly recordOpen: boolean;
  readonly onRecord: () => void;
  readonly onClose: () => void;
}) {
  const query = useAppData();
  if (query.isPending) return <CircularProgress aria-label="Loading your accounts" />;
  if (query.isError && !query.data)
    return (
      <Alert severity="error" action={<Button onClick={() => void query.refetch()}>Retry</Button>}>
        Could not load your accounts. {query.error.message}
      </Alert>
    );
  return (
    <LivePages data={query.data} recordOpen={recordOpen} onRecord={onRecord} onClose={onClose} />
  );
}
function LivePages({
  data,
  recordOpen,
  onRecord,
  onClose,
}: {
  readonly data: AppData;
  readonly recordOpen: boolean;
  readonly onRecord: () => void;
  readonly onClose: () => void;
}) {
  useHistoryRefresh(data);
  return (
    <>
      <Routes>
        <Route path="/" element={<LiveOverview data={data} onRecord={onRecord} />} />
        <Route path="/accounts" element={<AccountsPage data={data} />} />
        <Route path="/budget" element={<BudgetPage data={data} />} />
        <Route path="/history" element={<HistoryPage data={data} />} />
        <Route
          path="/analysis"
          element={
            data.bankConnections.some((connection) => connection.provider === "endute") ? (
              <AnalysisPage data={data} />
            ) : (
              <Navigate to="/accounts" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {recordOpen && (
        <Suspense fallback={null}>
          <SnapshotDialog data={data} mode="current" onClose={onClose} />
        </Suspense>
      )}
    </>
  );
}
