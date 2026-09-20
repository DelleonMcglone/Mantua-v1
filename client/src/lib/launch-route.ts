/**
 * Task 071 (Phase 15, MX-004 / MX-007) — where a launch lands.
 *
 * The app keeps its route in memory, so a notification tap, a home-screen
 * shortcut, or a shared link needs a way in from the URL. This is the
 * whole vocabulary: `?open=<surface>` plus a few qualifiers. Anything
 * unknown is ignored (the app opens where it would have anyway), and the
 * query is stripped from the address bar once read so a refresh does not
 * replay it. Pure; App.tsx maps the target onto its Route.
 */
import type { SportId } from "../features/markets/sports.ts";

// Type-only import above: `sports.ts` carries icon components, and this
// module runs under node:test. The list is checked against the union.
const LEAGUES = ["nfl"] as const satisfies readonly SportId[];
const isSportId = (v: string | null): v is SportId =>
  v !== null && (LEAGUES as readonly string[]).includes(v);

export type LaunchTarget =
  | { kind: "market"; league: SportId; eventId?: string; side?: 0 | 1 }
  | { kind: "profile" }
  | { kind: "agent" }
  | { kind: "discover" }
  | { kind: "home" };

const LAUNCH_KEYS = ["open", "league", "event", "side", "source"] as const;

export function parseLaunchParams(search: string): LaunchTarget | null {
  const params = new URLSearchParams(search);
  const open = params.get("open");
  switch (open) {
    case "market": {
      const league = params.get("league");
      if (!isSportId(league)) return null;
      const eventId = params.get("event")?.trim();
      const side = params.get("side");
      return {
        kind: "market",
        league,
        ...(eventId && /^[\w:-]{1,64}$/.test(eventId) ? { eventId } : {}),
        ...(side === "0" || side === "1" ? { side: side === "0" ? 0 : 1 } : {}),
      };
    }
    case "profile":
    case "agent":
    case "discover":
    case "home":
      return { kind: open };
    default:
      return null;
  }
}

/** The same URL with every launch key removed (for `history.replaceState`). */
export function stripLaunchParams(href: string): string {
  const url = new URL(href);
  for (const key of LAUNCH_KEYS) url.searchParams.delete(key);
  return url.pathname + (url.search ? url.search : "") + url.hash;
}

/** True when the page was opened from the installed app (manifest start_url). */
export function launchedFromInstalledApp(search: string): boolean {
  return new URLSearchParams(search).get("source") === "pwa";
}
