import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@wealth/api/types";
export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      headers: () =>
        document.visibilityState === "visible" ? { "x-wealth-activity": "foreground" } : {},
    }),
  ],
});
export const backgroundApi = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
