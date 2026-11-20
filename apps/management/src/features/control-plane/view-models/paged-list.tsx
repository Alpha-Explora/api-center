"use client";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

/** A list the gateway returns in pages: the loaded items so far, and a way to load the next page. */
export function usePagedList<T>(queryKey: QueryKey, fetchPage: (cursor?: string) => Promise<PageResult<T>>, options: { enabled?: boolean } = {}) {
  const query = useInfiniteQuery({
    queryKey: [...queryKey, "pages"],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
  });
  return {
    items: query.data?.pages.flatMap((page) => page.items),
    error: query.error,
    isPending: query.isPending,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  };
}

export function LoadMore({ list }: { list: { hasMore: boolean; loadingMore: boolean; loadMore: () => void } }) {
  if (!list.hasMore) return null;
  return (
    <div className="flex justify-center p-3">
      <Button size="sm" variant="outline" disabled={list.loadingMore} onClick={list.loadMore}>
        {list.loadingMore ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
