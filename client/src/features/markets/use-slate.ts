import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";

/** Mirrors the server's `PublicSlate` whitelist (server/src/lib/sports/public-slate.ts). */
export interface SlateTeam {
  key: string;
  name: string;
  abbreviation: string;
  logo?: string;
}

export interface SlateEvent {
  providerEventId: string;
  startsAt: number;
  status: string;
  home: SlateTeam;
  away: SlateTeam;
  homeScore?: number;
  awayScore?: number;
  homeWinProbabilityBps?: number;
  /** True when the probability is the live on-chain pool price. */
  liveOdds?: boolean;
}

export interface Slate {
  league: string;
  delayed: boolean;
  fetchedAt: number;
  events: SlateEvent[];
}

interface SlateResponse {
  leagues: Record<string, Slate | { error: string }>;
}

export interface SlateState {
  /** Per-league slates that loaded; a failed league is simply absent. */
  slates: Partial<Record<string, Slate>>;
  loading: boolean;
  /** True when the whole request failed (not a single league). */
  error: boolean;
}

const REFRESH_MS = 60_000;

/**
 * Games across the covered leagues, refreshed once a minute. Defaults to
 * the provider's default slate; pass `dates` (YYYYMMDD-YYYYMMDD) for an
 * explicit window, and `league` to fetch a single league instead of all.
 * Public — no login needed to browse (B5-007); the server's provider cache
 * makes the poll cheap.
 */
interface SlateInner extends SlateState {
  /** Which `dates`+`league` window the state was loaded for. `null` =
   *  nothing yet. Comparing it against the requested window derives
   *  `loading` during a week switch without a setState-in-effect. */
  loadedFor: string | null;
}

export function useSlate(dates?: string, league?: string): SlateState {
  const requestKey = `${league ?? ""}|${dates ?? ""}`;
  const [state, setState] = useState<SlateInner>({
    slates: {},
    loading: true,
    error: false,
    loadedFor: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (league) params.set("league", league);
        if (dates) params.set("dates", dates);
        const query = params.size > 0 ? `?${params.toString()}` : "";
        const res = await api.get<SlateResponse>(`/api/sports/slate${query}`);
        if (cancelled) return;
        const slates: Partial<Record<string, Slate>> = {};
        for (const [slateLeague, value] of Object.entries(res.leagues)) {
          if (!("error" in value)) slates[slateLeague] = value;
        }
        setState({ slates, loading: false, error: false, loadedFor: requestKey });
      } catch {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false, error: true, loadedFor: requestKey }));
        }
      }
    };

    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dates, league, requestKey]);

  const switching = state.loadedFor !== null && state.loadedFor !== requestKey;
  return {
    slates: state.slates,
    error: state.error,
    loading: state.loading || switching,
  };
}
