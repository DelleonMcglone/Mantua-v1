import { FeeExplainer } from "../FeeExplainer.tsx";
import { Freshness } from "../Freshness.tsx";
import { priceMovement } from "../market-movement.ts";
import { formatProbability } from "../probability-source.ts";
import { ProbabilityTag } from "../ProbabilityTag.tsx";
import type { Slate, SlateEvent } from "../use-slate.ts";
import type { DetailResponse } from "./detail-types.ts";

/**
 * T-010 — the market page's simple layer: the two prices with their source,
 * recent movement from the recorded series, the game's state, and when the
 * data was last updated. Everything deeper sits behind "More".
 */
export function MarketSummary({
  event,
  slate,
  detail,
}: {
  event: SlateEvent;
  slate: Slate;
  detail: DetailResponse | null;
}) {
  const live = event.status === "in_progress";
  const final = event.status === "final";
  const kickoff = new Date(event.startsAt * 1000).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const sides = [
    { team: event.home, side: 0 as const },
    { team: event.away, side: 1 as const },
  ];
  const hasPrice = typeof event.homeWinProbabilityBps === "number";
  return (
    <section
      data-testid="market-summary"
      className="rounded-md border border-border-soft bg-panel-solid p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-dim">
        {live ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-green">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" /> Live
            {typeof event.homeScore === "number" && typeof event.awayScore === "number" && (
              <span className="font-mono text-text">
                {event.away.abbreviation} {event.awayScore} · {event.home.abbreviation}{" "}
                {event.homeScore}
              </span>
            )}
          </span>
        ) : final ? (
          <span className="font-medium">Final</span>
        ) : (
          <span>Kickoff {kickoff}</span>
        )}
        {event.home.record && event.away.record && (
          <span>
            {event.away.abbreviation} {event.away.record} · {event.home.abbreviation}{" "}
            {event.home.record}
          </span>
        )}
        <Freshness source={slate} className="ml-auto" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {sides.map(({ team, side }) => {
          const p = formatProbability(event.homeWinProbabilityBps, side);
          const move = priceMovement(detail?.prices ?? [], side);
          return (
            <div key={side} className="rounded-md border border-border-soft px-3 py-2.5">
              <div className="text-[12px] text-text-dim">{team.name}</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="font-mono text-[24px] font-semibold text-text">{p.cents}</span>
                <span className="text-[12px] text-text-dim">{p.percent} chance</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span
                  className={
                    move.deltaBps === null
                      ? "text-text-mute"
                      : move.deltaBps > 0
                        ? "text-green"
                        : move.deltaBps < 0
                          ? "text-yellow"
                          : "text-text-dim"
                  }
                >
                  {move.label}
                </span>
                {hasPrice && <ProbabilityTag liveOdds={event.liveOdds} />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11.5px] text-text-dim">
        <span>Trade before or during the game · closes when it goes final</span>
        <FeeExplainer />
      </div>
    </section>
  );
}
