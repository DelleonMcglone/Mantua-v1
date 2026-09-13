import { useEffect, useMemo, useState } from "react";
import { ComingSoon } from "./ComingSoon.tsx";
import { defaultSelection, type Selection } from "./default-selection.ts";
import { GamesList } from "./GamesList.tsx";
import { LeagueHeader } from "./LeagueHeader.tsx";
import { MarketDetail } from "./detail/MarketDetail.tsx";
import { getSport, type SportId } from "./sports.ts";
import { TradeTicket } from "./ticket/TradeTicket.tsx";
import { buildWeekOptions, type WeekOption } from "./week-options.ts";
import { useSlate } from "./use-slate.ts";

interface Props {
  sport: SportId;
  onSelectSport: (id: SportId) => void;
  onBack: () => void;
  /** Hand a matchup to the autonomous agent (detail view's Agent tab). */
  onAgent: (message: string) => void;
  /** "View position" from the executed card. */
  onViewPositions: () => void;
  /** Phase 12 — the historical market browser for this league. */
  onBrowseHistory: () => void;
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

/** Full-screen league page: date-grouped game rows with contract prices, the market page in place, and the ticket alongside. */
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
  onBrowseHistory,
}: Props) {
  const active = getSport(sport);
  const weekOptions = useMemo(() => buildWeekOptions(), []);
  const [week, setWeek] = useState<WeekOption>(() => weekOptions[1]);
  const { slates, loading } = useSlate(week.dates);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const slate = slates[active.id];
  const events = useMemo(() => slate?.events ?? [], [slate]);

  const effective = useMemo<Selection | null>(
    () => selection ?? defaultSelection(events, { initialEventId, initialSide, initialTeam }),
    [selection, events, initialEventId, initialSide, initialTeam],
  );

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
      <LeagueHeader
        sport={active}
        slate={slate}
        weekOptions={weekOptions}
        week={week}
        onBack={onBack}
        onSelectWeek={(option) => {
          setWeek(option);
          setSelection(null);
          setDetailId(null);
        }}
      />

      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          {detailEvent && slate && (
            <MarketDetail
              event={detailEvent}
              slate={slate}
              league={sport}
              onBack={() => {
                setDetailId(null);
              }}
              onAgent={onAgent}
              onBrowseHistory={onBrowseHistory}
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
