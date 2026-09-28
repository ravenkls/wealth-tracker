import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AppearanceProvider } from "./app/AppearanceProvider";

function handleApiError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    (error.data as { code?: string } | undefined)?.code === "UNAUTHORIZED"
  ) {
    queryClient.clear();
    queryClient.setQueryData(["session"], null);
  }
}
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleApiError }),
  mutationCache: new MutationCache({ onError: handleApiError }),
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
    mutations: { retry: false },
  },
});
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root.");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppearanceProvider>
    </QueryClientProvider>
  </StrictMode>,
);
