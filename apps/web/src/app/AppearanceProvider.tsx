import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, CssBaseline, Snackbar, ThemeProvider } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { themes, type ThemeMode } from "./theme";

const AppearanceContext = createContext<{
  mode: ThemeMode;
  saving: boolean;
  ready: boolean;
  toggle: () => void;
} | null>(null);

export function AppearanceProvider({ children }: { readonly children: ReactNode }) {
  const [cachedMode, setCachedMode] = useState<ThemeMode>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.session.query(),
    refetchOnWindowFocus: true,
  });
  const queryKey = ["appearance", session.data?.email];
  const appearance = useQuery({
    queryKey,
    queryFn: () => api.appearance.get.query(),
    enabled: !!session.data,
    refetchOnWindowFocus: true,
  });
  const mutation = useMutation({
    mutationFn: (input: { mode: ThemeMode; expectedVersion: number }) =>
      api.appearance.save.mutate(input),
    onSuccess: (value) => client.setQueryData(queryKey, value),
    onError: () => void client.invalidateQueries({ queryKey }),
  });
  if (session.data && appearance.data && appearance.data.mode !== cachedMode) {
    setCachedMode(appearance.data.mode);
  }
  const mode = session.data
    ? ((mutation.isPending ? mutation.variables.mode : appearance.data?.mode) ?? cachedMode)
    : cachedMode;
  useEffect(() => {
    if (!session.data || !appearance.data) return;
    const savedMode = appearance.data.mode;
    try {
      localStorage.setItem("wealth-theme", savedMode);
    } catch {
      // The account preference still works when browser storage is unavailable.
    }
  }, [session.data, appearance.data]);
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    document.documentElement.style.backgroundColor = themes[mode].palette.background.default;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", themes[mode].palette.background.default);
  }, [mode]);
  const failed = !!session.data && (mutation.isError || appearance.isError);
  return (
    <AppearanceContext
      value={{
        mode,
        saving: mutation.isPending,
        ready: !!session.data && !!appearance.data,
        toggle: () => {
          if (!session.data || !appearance.data || mutation.isPending) return;
          mutation.mutate({
            mode: mode === "dark" ? "light" : "dark",
            expectedVersion: appearance.data.version,
          });
        },
      }}
    >
      <ThemeProvider theme={themes[mode]}>
        <CssBaseline enableColorScheme />
        {children}
        <Snackbar open={failed} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
          <Alert
            severity="error"
            action={
              appearance.isError ? (
                <Button color="inherit" onClick={() => void appearance.refetch()}>
                  Retry
                </Button>
              ) : undefined
            }
            onClose={mutation.isError ? () => mutation.reset() : undefined}
          >
            {mutation.isError
              ? "Could not save your theme. Your saved preference has been restored; try again."
              : "Could not load your theme preference."}
          </Alert>
        </Snackbar>
      </ThemeProvider>
    </AppearanceContext>
  );
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("AppearanceProvider is required.");
  return value;
}
