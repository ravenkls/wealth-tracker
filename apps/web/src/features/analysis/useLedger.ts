import { useEffect, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { backgroundApi } from "../../lib/api";

// The ledger is paginated server-side; fetch every page so analysis covers the whole range.
export function useLedger(range: { from: string; to: string }) {
  const query = useInfiniteQuery({
    queryKey: ["transaction-ledger", range.from, range.to],
    queryFn: ({ pageParam }) =>
      backgroundApi.analysis.ledger.query({
        ...range,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 300000,
  });
  const { hasNextPage, isFetching, isFetchNextPageError, isError, fetchNextPage, data } = query;
  useEffect(() => {
    if (hasNextPage && !isFetching && !isFetchNextPageError && !isError) void fetchNextPage();
  }, [hasNextPage, isFetching, isFetchNextPageError, isError, fetchNextPage]);
  const entries = useMemo(() => data?.pages.flatMap((page) => page.entries) ?? [], [data]);
  return { query, entries, ready: !!data && !hasNextPage };
}
