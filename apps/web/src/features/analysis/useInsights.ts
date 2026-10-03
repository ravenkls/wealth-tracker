import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { backgroundApi } from "../../lib/api";

// Insights are paginated server-side; fetch every page so totals cover the whole range.
export function useInsights(range: { from: string; to: string }, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: ["transaction-insights", range.from, range.to],
    queryFn: ({ pageParam }) =>
      backgroundApi.analysis.insights.query({
        ...range,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 60000,
    enabled,
  });
  const { hasNextPage, isFetching, isFetchNextPageError, isError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetching && !isFetchNextPageError && !isError) void fetchNextPage();
  }, [hasNextPage, isFetching, isFetchNextPageError, isError, fetchNextPage]);
  return { query, pages: query.data?.pages ?? [], ready: !!query.data && !hasNextPage };
}
