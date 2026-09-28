import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
export type AppData = Awaited<ReturnType<typeof api.bootstrap.query>>;
export function useAppData() {
  return useQuery({
    queryKey: ["wealth"],
    queryFn: () => api.bootstrap.query(),
    refetchOnWindowFocus: true,
  });
}
export function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["wealth"] });
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please retry.";
}
