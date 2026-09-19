import { dispatchAddLeg } from "@/features/combos/combo-draft.ts";
import { isTradableStatus } from "./market-trade-core.ts";
import { formatProbability } from "./probability-source.ts";
import { ProbabilityTag } from "./ProbabilityTag.tsx";
import type { SlateEvent, SlateTeam } from "./use-slate.ts";

/** Team mark: logo when the feed carries one, else the abbreviation. */
export function TeamMark({ team }: { team: SlateTeam }) {
  return team.logo ? (
    <img src={team.logo} alt="" className="h-6 w-6 shrink-0 object-contain" loading="lazy" />
  ) : (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chip font-mono text-[9px] text-text-mute">
      {team.abbreviation.slice(0, 3)}
    </span>
  );
}

/**
 * One matchup on the league page. Clicking anywhere on it opens the market
 * page; the price buttons are tap ONE of the trade budget — they select
 * that side into the ticket without leaving the list. Every price carries
 * its source chip (T-021). Browsing is public; only executing needs login.
 */
export function GameRow({
  event,
  league,
  selected,
  selectedOutcome,
  onPick,
  onOpen,
}: {
  event: SlateEvent;
  /** Task 072 — the league slug a `+ Combo` leg carries. */
  league: string;
  selected: boolean;
  selectedOutcome: 0 | 1 | null;
  onPick: (outcome: 0 | 1) => void;
  onOpen: () => void;
}) {
  const live = event.status === "in_progress";
  const final = event.status === "final";
  // D-103 in-play: prices stay clickable through the game; the window
  // closes on final (or void), not at kickoff.
  const tradeable = Boolean(event.liveOdds) && isTradableStatus(event.status);
  const time = new Date(event.startsAt * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const rows = [
    { team: event.away, side: 1 as const, score: event.awayScore },
    { team: event.home, side: 0 as const, score: event.homeScore },
  ];

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="game-row"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={`cursor-pointer rounded-md border bg-panel-solid px-3 py-3 transition-colors hover:border-accent/30 md:px-4 ${selected ? "border-accent/40" : "border-border-soft"}`}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] text-text-dim">
        {live ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-green">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" /> Live
          </span>
        ) : final ? (
          <span className="font-medium">Final</span>
        ) : (
          <span>{time}</span>
        )}
        {typeof event.homeWinProbabilityBps === "number" && (
          <ProbabilityTag liveOdds={event.liveOdds} />
        )}
      </div>
      {rows.map(({ team, side, score }) => (
        <div key={side} className="flex items-center gap-2.5 py-1">
          <TeamMark team={team} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{team.name}</span>
          {(live || final) && typeof score === "number" && (
            <span className="w-8 text-right font-mono text-[14px]">{score}</span>
          )}
          <button
            type="button"
            data-price-side={side}
            disabled={!tradeable}
            aria-label={`${tradeable ? "Trade" : "Price for"} ${team.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onPick(side);
            }}
            className={`min-h-11 w-[104px] rounded-md px-3 py-2 text-center font-mono text-[13px] font-semibold transition-colors md:min-h-0 ${
              selected && selectedOutcome === side
                ? "bg-accent text-white"
                : tradeable
                  ? "bg-chip text-text hover:bg-accent/25 active:bg-accent/40 cursor-pointer"
                  : "bg-chip/50 text-text-mute"
            }`}
          >
            {team.abbreviation} {formatProbability(event.homeWinProbabilityBps, side).cents}
          </button>
          <button
            type="button"
            data-combo-side={side}
            disabled={!tradeable}
            aria-label={`Add ${team.name} to a combo`}
            title="Add to combo"
            onClick={(e) => {
              e.stopPropagation();
              dispatchAddLeg({
                providerEventId: event.providerEventId,
                outcomeIndex: side,
                teamName: team.name,
                opponentName: side === 0 ? event.away.name : event.home.name,
                league,
                kickoffAt: event.startsAt,
              });
            }}
            className={`min-h-11 rounded-md border px-2 py-2 font-mono text-[11px] md:min-h-0 md:py-1 ${
              tradeable
                ? "border-border-soft text-text-dim hover:border-accent/40 hover:text-text cursor-pointer"
                : "border-border-soft/50 text-text-mute"
            }`}
          >
            + Combo
          </button>
        </div>
      ))}
    </div>
  );
}
