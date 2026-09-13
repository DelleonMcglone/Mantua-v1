import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ComingSoon } from "./ComingSoon.tsx";
import { Freshness } from "./Freshness.tsx";
import { GamesList } from "./GamesList.tsx";
import { MarketDetail } from "./detail/MarketDetail.tsx";
import { isTradableStatus } from "./market-trade-core.ts";
import { getSport, type SportId } from "./sports.ts";
import { resolveTeamSelection } from "./team-select.ts";
import { TradeTicket } from "./ticket/TradeTicket.tsx";
import { WeekSelector } from "./WeekSelector.tsx";
import { buildWeekOptions, type WeekOption } from "./week-options.ts";
import { useSlate, type SlateEvent } from "./use-slate.ts";

interface Props {
  sport: SportId;
  onSelectSport: (id: SportId) => void;
  onBack: () => void;
  /** Hand a matchup to the autonomous agent (detail view's Agent tab). */
  onAgent: (message: string) => void;
  /** "View position" from the executed card. */
  onViewPositions: () => void;
  /** The game in view, for the dock's contextual quick actions (T-016). */
  onFocusGame?: ((game: { away: string; home: string } | null) => void) | undefined;
  /** Deep-links: preselect this game / this team's side, open the ticket
   *  on this direction, pre-fill the amount (one-click Close). */
  initialEventId?: string | undefined;
  initialSide?: 0 | 1 | undefined;
  initialTeam?: string | undefined;
  initialDirection?: "buy" | "sell" | undefined;
  initialAmount?: string | undefined;
}

interface Selection {
  event: SlateEvent;
  outcomeIndex: 0 | 1;
}

/**
 * Full-screen league page: date-grouped game rows with contract prices,
 * and the trade ticket alongside. A price tap selects that side into the
 * ticket (tap one of three); a row tap opens the market page. Covered
 * leagues only — "soon" leagues render the coming-soon state.
 */
export function LeaguePage({
  sport,
  onSelectSport,
  onBack,
  onAgent,
  onViewPositions,
  onFocusGame,
  initialEventId,
  initialSide,
  initialTeam,
  initialDirection,
  initialAmount,
}: Props) {
  const active = getSport(sport);
  const weekOptions = useMemo(() => buildWeekOptions(), []);
  const [week, setWeek] = useState<WeekOption>(() => weekOptions[1]);
  const { slates, loading } = useSlate(week.dates);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const slate = slates[active.id];
  const events = useMemo(() => slate?.events ?? [], [slate]);

  // Default selection: the deep-linked game or team, else the first
  // tradeable game, else the first game — the ticket is always populated.
  const effective = useMemo<Selection | null>(() => {
    if (selection) return selection;
    const linked = initialEventId
      ? events.find((e) => e.providerEventId === initialEventId)
      : undefined;
    if (linked) return { event: linked, outcomeIndex: initialSide ?? 0 };
    const byTeam = initialTeam ? resolveTeamSelection(events, initialTeam) : null;
    const teamEvent = byTeam ? events.find((e) => e.providerEventId === byTeam.eventId) : undefined;
    if (byTeam && teamEvent) return { event: teamEvent, outcomeIndex: byTeam.outcomeIndex };
    const first =
      events.find((e) => e.liveOdds && isTradableStatus(e.status)) ??
      events.find((e) => isTradableStatus(e.status)) ??
      events.at(0);
    return first ? { event: first, outcomeIndex: 0 } : null;
  }, [selection, events, initialEventId, initialSide, initialTeam]);

  useEffect(() => {
    onFocusGame?.(
      effective ? { away: effective.event.away.name, home: effective.event.home.name } : null,
    );
    return () => {
      onFocusGame?.(null);
    };
  }, [effective, onFocusGame]);

  const detailEvent = detailId
    ? (events.find((e) => e.providerEventId === detailId) ?? null)
    : null;
  if (active.coverage === "soon")
    return <ComingSoon sport={sport} onSelectSport={onSelectSport} onBack={onBack} />;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to home"
            className="mt-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-soft bg-transparent text-text-dim transition-colors hover:text-text cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-[28px] font-bold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-[13px] text-text-dim">{active.blurb}</p>
            {slate && <Freshness source={slate} className="mt-1" />}
          </div>
        </div>
        <WeekSelector
          options={weekOptions}
          active={week}
          onSelect={(option) => {
            setWeek(option);
            setSelection(null);
            setDetailId(null);
          }}
        />
      </div>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          {detailEvent && slate && (
            <MarketDetail
              event={detailEvent}
              slate={slate}
              onBack={() => {
                setDetailId(null);
              }}
              onAgent={onAgent}
            />
          )}
          {!detailEvent && (
            <GamesList
              label={active.label}
              weekLabel={week.label}
              slate={slate}
              loading={loading}
              events={events}
              selected={effective}
              onPick={(event, outcomeIndex) => {
                setSelection({ event, outcomeIndex });
              }}
              onOpen={(event) => {
                setSelection({ event, outcomeIndex: 0 });
                setDetailId(event.providerEventId);
              }}
            />
          )}
        </div>

        <div className="w-full shrink-0 lg:w-[320px]">
          {effective ? (
            <TradeTicket
              key={`${effective.event.providerEventId}-${String(effective.outcomeIndex)}`}
              event={effective.event}
              outcomeIndex={effective.outcomeIndex}
              initialDirection={initialDirection}
              initialAmount={
                effective.event.providerEventId === initialEventId ? initialAmount : undefined
              }
              onPick={(outcomeIndex) => {
                setSelection({ event: effective.event, outcomeIndex });
              }}
              onViewPositions={onViewPositions}
            />
          ) : (
            <div className="rounded-md border border-border-soft px-4 py-6 text-center text-[12.5px] text-text-dim">
              Pick a price on any upcoming game to trade it here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
