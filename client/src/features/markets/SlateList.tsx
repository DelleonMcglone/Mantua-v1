import type { Sport } from "./sports.ts";
import type { Slate, SlateEvent, SlateTeam } from "./use-slate.ts";

interface SlateListProps {
  sport: Sport;
  slate: Slate | undefined;
  loading: boolean;
  /** Matchup click — opens the analyst on this game (B5-004). */
  onAnalyze: (event: SlateEvent, sport: Sport) => void;
  /** Trade click — the position panel (B7-003). Only rendered when the
   *  event has a live on-chain market. */
  onTrade?: (event: SlateEvent, sport: Sport) => void;
}

/**
 * One league's slate as matchup cards (B5-003): team marks, start time,
 * live/final state, and the provider's implied win probability. Cards are
 * buttons — clicking one asks the analyst about the game, which stays open
 * to logged-out users (B5-007). Trading buttons live on the market page,
 * behind the login gate, once markets open.
 */
export function SlateList({ sport, slate, loading, onAnalyze, onTrade }: SlateListProps) {
  if (loading && !slate) {
    return (
      <div className="rounded-md border border-border-soft px-4 py-6 text-center text-[12.5px] text-text-dim">
        Loading {sport.label} games…
      </div>
    );
  }

  if (!slate) {
    return (
      <div className="rounded-md border border-border-soft px-4 py-6 text-center text-[12.5px] text-text-dim">
        {sport.label} scores are temporarily unavailable. They&apos;ll be back shortly.
      </div>
    );
  }

  // B5-009 — off-season / quiet day, distinct from an error.
  if (slate.events.length === 0) {
    return (
      <div className="rounded-md border border-border-soft px-4 py-6 text-center">
        <p className="text-[13px] font-medium">No {sport.label} games today</p>
        <p className="mx-auto mt-1.5 max-w-xs text-[12px] leading-relaxed text-text-dim">
          Games appear here and markets open alongside them.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {slate.delayed && (
        <div className="rounded-sm border border-yellow/40 bg-yellow/10 px-3 py-1.5 text-[11px] text-yellow">
          Live data is delayed — scores and odds may lag the game.
        </div>
      )}
      {slate.events.map((event) => (
        <MatchupCard
          key={event.providerEventId}
          event={event}
          onClick={() => {
            onAnalyze(event, sport);
          }}
          onTrade={
            onTrade && event.liveOdds && event.status === "scheduled"
              ? () => {
                  onTrade(event, sport);
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}

function MatchupCard({
  event,
  onClick,
  onTrade,
}: {
  event: SlateEvent;
  onClick: () => void;
  onTrade?: (() => void) | undefined;
}) {
  const live = event.status === "in_progress";
  const final = event.status === "final";
  const voided = ["postponed", "cancelled", "suspended"].includes(event.status);
  // Providers send 0–0 for games that haven't started; a scheduled game
  // showing a score reads as a bug, so scores wait for live/final.
  const showScores =
    (live || final) && typeof event.homeScore === "number" && typeof event.awayScore === "number";
  const homeBps = event.homeWinProbabilityBps;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Analyze ${event.away.name} at ${event.home.name}`}
      className="w-full rounded-md border border-border-soft bg-panel-solid px-4 py-3 text-left transition-colors hover:border-accent/40 cursor-pointer"
    >
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <StatusChip live={live} final={final} voided={voided} startsAt={event.startsAt} />
        <span className="text-text-mute">
          {event.liveOdds && (
            <span className="mr-2 rounded-[3px] bg-accent/15 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-accent">
              Market odds
            </span>
          )}
          Tap to analyze
        </span>
      </div>
      <TeamRow
        team={event.away}
        score={showScores ? event.awayScore : undefined}
        probabilityBps={typeof homeBps === "number" ? 10_000 - homeBps : undefined}
        winner={final && showScores ? (event.awayScore ?? 0) > (event.homeScore ?? 0) : false}
      />
      <div className="my-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-mute">
        <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
        at
        <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
      </div>
      <TeamRow
        team={event.home}
        score={showScores ? event.homeScore : undefined}
        probabilityBps={homeBps}
        winner={final && showScores ? (event.homeScore ?? 0) > (event.awayScore ?? 0) : false}
      />
      {onTrade && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onTrade();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onTrade();
            }
          }}
          className="mt-2.5 block w-full rounded-sm border border-accent/40 bg-accent/10 py-1.5 text-center text-[12px] font-medium text-accent transition-colors hover:bg-accent/20"
        >
          Trade
        </span>
      )}
    </button>
  );
}

function TeamRow({
  team,
  score,
  probabilityBps,
  winner,
}: {
  team: SlateTeam;
  score: number | undefined;
  probabilityBps: number | undefined;
  winner: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {team.logo ? (
        <img src={team.logo} alt="" className="h-6 w-6 shrink-0 object-contain" loading="lazy" />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chip font-mono text-[9px] text-text-mute">
          {team.abbreviation.slice(0, 3)}
        </span>
      )}
      <span className={`min-w-0 flex-1 truncate text-[13px] ${winner ? "font-semibold" : ""}`}>
        {team.name}
      </span>
      {typeof probabilityBps === "number" && (
        <span className="rounded-[3px] bg-chip px-1.5 py-0.5 font-mono text-[11px] text-text-dim">
          {(probabilityBps / 100).toFixed(0)}%
        </span>
      )}
      {typeof score === "number" && (
        <span className={`w-8 text-right font-mono text-[14px] ${winner ? "font-semibold" : ""}`}>
          {score}
        </span>
      )}
    </div>
  );
}

function StatusChip({
  live,
  final,
  voided,
  startsAt,
}: {
  live: boolean;
  final: boolean;
  voided: boolean;
  startsAt: number;
}) {
  if (live) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-green">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" aria-hidden="true" />
        Live
      </span>
    );
  }
  if (final) return <span className="font-medium text-text-dim">Final</span>;
  if (voided) return <span className="font-medium text-yellow">Postponed</span>;
  return <span className="text-text-dim">{formatKickoff(startsAt)}</span>;
}

function formatKickoff(startsAt: number): string {
  const date = new Date(startsAt * 1000);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  return `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}
