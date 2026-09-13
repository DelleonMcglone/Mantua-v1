import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import { subscribeLive, type LiveStreamState } from "@/lib/live-stream.ts";

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
  /** Last ingest time (ms epoch); absent when nothing was ever ingested. */
  dataAsOf?: number;
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
  /** True while the live stream is open — data arrives as it changes. */
  streaming: boolean;
}

/** Poll cadence while the stream is not open (the pre-Phase-7 behavior). */
const REFRESH_MS = 60_000;

interface SlateInner extends Omit<SlateState, "streaming"> {
  /** Which `dates`+`league` window the state was loaded for. `null` =
   *  nothing yet. Comparing it against the requested window derives
   *  `loading` during a week switch without a setState-in-effect. */
  loadedFor: string | null;
  streamState: LiveStreamState;
}

function collect(
  leagues: Record<string, Slate | { error: string }>,
): Partial<Record<string, Slate>> {
  const slates: Partial<Record<string, Slate>> = {};
  for (const [league, value] of Object.entries(leagues)) {
    if (!("error" in value)) slates[league] = value;
  }
  return slates;
}

/**
 * Games across the covered leagues. Phase 7 / R-001: served by the live
 * stream (`/api/stream/live`) — a snapshot on connect, then only what
 * changed, at game speed — with the 60 s poll of `/api/sports/slate` as
 * the fallback whenever the stream is not open (connecting, shed by the
 * server, tab hidden). Data already on screen is never dropped while the
 * transport reconnects; `loading` is only true before the first data for
 * the requested window.
 *
 * Pass `dates` (YYYYMMDD-YYYYMMDD) for an explicit window and `league` to
 * scope to one league. Public — no login needed to browse (B5-007).
 */
export function useSlate(dates?: string, league?: string): SlateState {
  const requestKey = `${league ?? ""}|${dates ?? ""}`;
  const [state, setState] = useState<SlateInner>({
    slates: {},
    loading: true,
    error: false,
    loadedFor: null,
    streamState: "connecting",
  });

  useEffect(() => {
    let cancelled = false;
    const live = { state: "connecting" as LiveStreamState };

    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (league) params.set("league", league);
        if (dates) params.set("dates", dates);
        const query = params.size > 0 ? `?${params.toString()}` : "";
        const res = await api.get<SlateResponse>(`/api/sports/slate${query}`);
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          slates: collect(res.leagues),
          loading: false,
          error: false,
          loadedFor: requestKey,
        }));
      } catch {
        // A failed poll while the stream is open is not an error the user
        // needs — the stream is the source of truth then.
        if (!cancelled && live.state !== "open") {
          setState((prev) => ({ ...prev, loading: false, error: true, loadedFor: requestKey }));
        }
      }
    };

    const unsubscribe = subscribeLive(
      { league, dates },
      {
        onSnapshot: (snapshot) => {
          if (cancelled) return;
          setState((prev) => ({
            ...prev,
            slates: collect(snapshot.leagues),
            loading: false,
            error: false,
            loadedFor: requestKey,
          }));
        },
        onSlate: (slateLeague, slate) => {
          if (cancelled) return;
          setState((prev) => ({ ...prev, slates: { ...prev.slates, [slateLeague]: slate } }));
        },
        onState: (s) => {
          live.state = s;
          if (!cancelled) setState((prev) => ({ ...prev, streamState: s }));
          // Coming back from polling/hidden: refresh once so the fallback
          // data is not stale while the stream reconnects.
          if (s === "polling") void load();
        },
      },
    );

    // First paint does not wait on the stream: the CDN-cached poll answers
    // in one round trip, and the stream's snapshot supersedes it.
    void load();
    const timer = setInterval(() => {
      if (live.state !== "open" && document.visibilityState !== "hidden") void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(timer);
    };
  }, [dates, league, requestKey]);

  const switching = state.loadedFor !== null && state.loadedFor !== requestKey;
  return {
    slates: state.slates,
    error: state.error,
    loading: state.loading || switching,
    streaming: state.streamState === "open",
  };
}
