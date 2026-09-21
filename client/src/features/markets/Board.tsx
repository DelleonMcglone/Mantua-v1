import { Card } from "@/components/shell/Card.tsx";
import { LeagueLogo } from "@/components/shell/LeagueLogo.tsx";
import { Freshness } from "./Freshness.tsx";
import { SPORTS, type Sport } from "./sports.ts";
import { SlateList } from "./SlateList.tsx";
import { useSlate, type SlateEvent, type SlateState } from "./use-slate.ts";

interface BoardProps {
  /** Matchup click — open the analyst on the game (B5-004/B5-006: the
   *  analysis renders in the right column, next to the board). */
  onAnalyze: (question: string) => void;
  /** League heading click — the league's own market page. */
  onOpenLeague: (sport: Sport) => void;
  /** Trade click — open the position panel for this game (B7-003). */
  onTrade: (sport: Sport, eventId: string) => void;
  /** "All markets" — the cross-league Discover page (task 050, T-001). */
  onDiscover?: (() => void) | undefined;
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear())}${m}${day}`;
}

/** Today as a single-day slate window. */
function todayRange(): string {
  const t = ymd(new Date());
  return `${t}-${t}`;
}

/**
 * B5-001 — the home board: today's games in the covered league (NFL), as
 * matchup cards. Fetched with an explicit today-only window rather than
 * the provider default, because the default NFL scoreboard is the current
 * schedule week — midweek that is mostly finished games. Scoped to
 * `coverage: "launch"` leagues only. Browsing is open to everyone — the login gate guards
 * transactions, not this view (B5-007).
 */
export function Board({ onAnalyze, onOpenLeague, onTrade, onDiscover }: BoardProps) {
  // Phase 7 / R-001 — one live stream (one connection) carries every
  // launch league; each card reads its league out of the shared state.
  const today: SlateState = useSlate(todayRange());
  const launchSports = SPORTS.filter((s) => s.coverage === "launch");

  const handleAnalyze = (event: SlateEvent, sport: Sport) => {
    onAnalyze(
      `Analyze the ${sport.label} matchup: ${event.away.name} at ${event.home.name}. ` +
        `Who is favored to win, and what should a prediction-market trader watch?`,
    );
  };

  return (
    <>
      {launchSports.map((sport) => {
        const state = today;
        const slate = state.slates[sport.id];
        return (
          <Card key={sport.id}>
            <button
              type="button"
              onClick={() => {
                onOpenLeague(sport);
              }}
              className="mb-3 flex w-full items-center gap-2 bg-transparent p-0 text-left cursor-pointer group"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-accent/15 text-accent">
                <LeagueLogo league={sport} className="h-5 w-5" />
              </span>
              <span className="text-[14px] font-semibold group-hover:text-accent transition-colors">
                {sport.label}
              </span>
              <span className="ml-auto text-[11px] text-text-mute group-hover:text-accent transition-colors">
                View markets →
              </span>
            </button>
            {slate && <Freshness source={slate} className="mb-2" />}
            {state.error && !slate ? (
              <div className="rounded-md border border-border-soft px-4 py-6 text-center text-[12.5px] text-text-dim">
                Couldn&apos;t reach the scores service. Retrying automatically.
              </div>
            ) : (
              <SlateList
                sport={sport}
                slate={slate}
                loading={state.loading}
                onAnalyze={handleAnalyze}
                onTrade={(event, s) => {
                  onTrade(s, event.providerEventId);
                }}
              />
            )}
          </Card>
        );
      })}
      {onDiscover && (
        <button
          type="button"
          onClick={onDiscover}
          className="rounded-md border border-dashed border-border-soft px-4 py-2.5 text-[13px] font-medium text-text-dim transition-colors hover:border-accent hover:text-text cursor-pointer"
        >
          Browse all markets — filter by league, team, time, liquidity →
        </button>
      )}
    </>
  );
}
