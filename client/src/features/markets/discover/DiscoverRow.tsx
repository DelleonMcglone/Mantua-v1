import { compact } from "@/lib/format.ts";
import type { DiscoverMarket } from "../discovery.ts";
import { formatProbability } from "../probability-source.ts";
import { ProbabilityTag } from "../ProbabilityTag.tsx";
import { getSport, isSportId } from "../sports.ts";

function kickoff(startsAt: number): string {
  const d = new Date(startsAt * 1000);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay
    ? time
    : `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

/**
 * One market on the Discover page. A price tap is tap one of the trade
 * budget — it opens the league page with that side already in the ticket.
 * Liquidity and activity read in dollars and trades, never in pool units.
 */
export function DiscoverRow({
  market,
  onOpen,
}: {
  market: DiscoverMarket;
  onOpen: (side: 0 | 1 | null) => void;
}) {
  const live = market.status === "in_progress";
  const final = !(market.status === "scheduled" || market.status === "in_progress");
  const league = isSportId(market.league)
    ? getSport(market.league).label
    : market.league.toUpperCase();
  const sides = [
    { team: market.away, side: 1 as const, score: market.awayScore },
    { team: market.home, side: 0 as const, score: market.homeScore },
  ];
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="discover-row"
      onClick={() => {
        onOpen(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(null);
      }}
      className="cursor-pointer rounded-md border border-border-soft bg-panel-solid px-4 py-3 transition-colors hover:border-accent/30"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
        <span className="font-medium text-text">{league}</span>
        {live ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-green">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" /> Live
          </span>
        ) : final ? (
          <span>Final</span>
        ) : (
          <span>{kickoff(market.startsAt)}</span>
        )}
        {typeof market.homeWinProbabilityBps === "number" && (
          <ProbabilityTag liveOdds={market.liveOdds} />
        )}
        <span className="ml-auto flex gap-3 font-mono text-[10.5px] text-text-mute">
          <span title="Approximate depth available to trade against">
            {market.liquidityUsdc > 0
              ? `${compact(market.liquidityUsdc)} liquidity`
              : "No market yet"}
          </span>
          {market.fills24h > 0 && <span>{market.fills24h} trades today</span>}
        </span>
      </div>
      {sides.map(({ team, side, score }) => (
        <div key={side} className="flex items-center gap-2.5 py-1">
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{team.name}</span>
          {(live || final) && typeof score === "number" && (
            <span className="w-8 text-right font-mono text-[14px]">{score}</span>
          )}
          <button
            type="button"
            data-price-side={side}
            disabled={!market.tradeable}
            aria-label={`${market.tradeable ? "Trade" : "Price for"} ${team.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(side);
            }}
            className={`w-[96px] rounded-md px-3 py-1.5 text-center font-mono text-[13px] font-semibold transition-colors ${
              market.tradeable
                ? "bg-chip text-text hover:bg-accent/25 cursor-pointer"
                : "bg-chip/50 text-text-mute"
            }`}
          >
            {team.abbreviation} {formatProbability(market.homeWinProbabilityBps, side).cents}
          </button>
        </div>
      ))}
    </div>
  );
}
