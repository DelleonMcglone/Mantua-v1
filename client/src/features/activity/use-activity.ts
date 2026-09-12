import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import {
  kindQueryFor,
  type ActivityFilter,
  type ActivityItem,
  type ActivityPage,
} from "./activity-core.ts";

export interface UseActivity {
  items: ActivityItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

const PAGE = 40;

/**
 * Phase 9 / PF-019 — the user's timeline from `GET /api/activity`, one page
 * at a time (cursor = the oldest loaded entry). Re-fetches from the top when
 * the filter or the wallet changes. Null wallet → empty, no request.
 */
export function useActivity(walletAddress: string | null, filter: ActivityFilter): UseActivity {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (before: string | null, replace: boolean) => {
      if (!walletAddress) {
        setItems([]);
        setNextBefore(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: String(PAGE) });
        const kind = kindQueryFor(filter);
        if (kind) params.set("kind", kind);
        if (before) params.set("before", before);
        const page = await api.get<ActivityPage>(`/api/activity?${params.toString()}`);
        setItems((prev) => (replace ? page.items : [...prev, ...page.items]));
        setNextBefore(page.nextBefore);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load activity");
      } finally {
        setLoading(false);
      }
    },
    [walletAddress, filter],
  );

  useEffect(() => {
    // fetchPage sets state after its await; the synchronous setLoading is the
    // intentional load-state reset when the wallet or the filter changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPage(null, true);
  }, [fetchPage]);

  return {
    items,
    loading,
    error,
    hasMore: nextBefore !== null,
    loadMore: () => {
      if (nextBefore && !loading) void fetchPage(nextBefore, false);
    },
    refetch: () => {
      void fetchPage(null, true);
    },
  };
}
