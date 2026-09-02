import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api.ts";
import type { Position } from "./positions-types.ts";

interface FetchState {
  data: Position[] | null;
  error: ApiError | Error | null;
  loading: boolean;
}

interface State extends FetchState {
  /** Bump to refetch — increments after successful remove. */
  reload: () => void;
}

export function usePositions(): State {
  const [state, setState] = useState<FetchState>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ positions: Position[] }>("/api/positions")
      .then((res) => {
        if (cancelled) return;
        setState({ data: res.positions, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error("Failed to load positions");
        setState({ data: null, error: e, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const reload = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  return { ...state, reload };
}
