import { Card } from "@/components/shell/Card.tsx";
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
 * B5-001 — the home board: today's games across the covered leagues, as
 * matchup cards. Each league is fetched with an explicit today-only window
 * rather than the provider default, because ESPN's default NFL scoreboard
 * is the current schedule week — midweek that is mostly finished games.
 * Scoped to `coverage: "launch"` leagues only; the rest sit in the nav as
 * Coming Soon. Browsing is open to everyone — the login gate guards
 * transactions, not this view (B5-007).
 */
export function Board({ onAnalyze, onOpenLeague, onTrade }: BoardProps) {
  const wnba = useSlate(todayRange(), "wnba");
  const nfl = useSlate(todayRange(), "nfl");
  const states: Partial<Record<string, SlateState>> = { wnba, nfl };
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
        const Icon = sport.icon;
        const state = states[sport.id];
        const slate = state?.slates[sport.id];
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
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-[14px] font-semibold group-hover:text-accent transition-colors">
                {sport.label}
              </span>
              <span className="ml-auto text-[11px] text-text-mute group-hover:text-accent transition-colors">
                View markets →
              </span>
            </button>
            {state?.error && !slate ? (
              <div className="rounded-md border border-border-soft px-4 py-6 text-center text-[12.5px] text-text-dim">
                Couldn&apos;t reach the scores service. Retrying automatically.
              </div>
            ) : (
              <SlateList
                sport={sport}
                slate={slate}
                loading={state?.loading ?? true}
                onAnalyze={handleAnalyze}
                onTrade={(event, s) => {
                  onTrade(s, event.providerEventId);
                }}
              />
            )}
          </Card>
        );
      })}
    </>
  );
}
