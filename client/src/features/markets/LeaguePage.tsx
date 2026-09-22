import { useEffect, useMemo, useState } from "react";
import { useTicketInSheet } from "@/hooks/use-media-query.ts";
import { ComingSoon } from "./ComingSoon.tsx";
import { defaultSelection, type Selection } from "./default-selection.ts";
import { GamesList } from "./GamesList.tsx";
import { LeagueHeader } from "./LeagueHeader.tsx";
import { LiveGlance } from "./live/LiveGlance.tsx";
import { MarketDetail } from "./detail/MarketDetail.tsx";
import { isWithinLocalWindow } from "./local-window.ts";
import { getSport, type SportId } from "./sports.ts";
import { TradeSheet } from "./ticket/TradeSheet.tsx";
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
  /** Phase 11 — the historical market browser for this league. */
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

/**
 * Full-screen league page: date-grouped game rows with contract prices, the
 * market page in place, and the ticket alongside — or, below `lg`, in a
 * bottom sheet that a price tap opens (task 071, MX-002). Phones also get
 * the live glance above the list (MX-003).
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
  onBrowseHistory,
}: Props) {
  const active = getSport(sport);
  const inSheet = useTicketInSheet();
  const weekOptions = useMemo(() => buildWeekOptions(), []);
  const [week, setWeek] = useState<WeekOption>(() => weekOptions[1]);
  const { slates, loading } = useSlate(week.dates);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // A deep link (a Discover price tap, a Close, a notification) opens the
  // sheet; the list's default selection never does.
  const [sheetOpen, setSheetOpen] = useState(() => Boolean(initialEventId ?? initialTeam));

  const slate = slates[active.id];
  // week.dates over-fetches (a UTC-day-padded superset — local-window.ts);
  // filter back down to the real local week the picker shows.
  const events = useMemo(
    () =>
      (slate?.events ?? []).filter((e) =>
        isWithinLocalWindow(e.startsAt, week.start, week.endExclusive),
      ),
    [slate, week],
  );

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

  const pick = (event: Selection["event"], outcomeIndex: 0 | 1) => {
    setSelection({ event, outcomeIndex });
    setSheetOpen(true);
  };
  const open = (eventId: string) => {
    const event = events.find((e) => e.providerEventId === eventId);
    if (event) setSelection({ event, outcomeIndex: 0 });
    setDetailId(eventId);
  };
  const ticket = effective ? (
    <TradeTicket
      key={`${effective.event.providerEventId}-${String(effective.outcomeIndex)}`}
      event={effective.event}
      outcomeIndex={effective.outcomeIndex}
      initialDirection={initialDirection}
      initialAmount={effective.event.providerEventId === initialEventId ? initialAmount : undefined}
      onPick={(outcomeIndex) => {
        setSelection({ event: effective.event, outcomeIndex });
      }}
      onViewPositions={onViewPositions}
    />
  ) : (
    <div className="rounded-md border border-border-soft px-4 py-6 text-center text-[12.5px] text-text-dim">
      Pick a price on any upcoming game to trade it here.
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 md:px-6 md:py-6">
      <LeagueHeader
        sport={active}
        slate={slate}
        weekOptions={weekOptions}
        week={week}
        onBack={onBack}
        onSelectSport={onSelectSport}
        onSelectWeek={(option) => {
          setWeek(option);
          setSelection(null);
          setDetailId(null);
        }}
      />

      <div className="mt-4 flex flex-col gap-8 md:mt-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          {!detailEvent && <LiveGlance events={events} onOpen={open} className="mb-4 md:hidden" />}
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
              onPick={pick}
              onOpen={(event) => {
                open(event.providerEventId);
              }}
            />
          )}
        </div>

        {!inSheet && <div className="w-full shrink-0 lg:w-[320px]">{ticket}</div>}
      </div>
      {inSheet && (
        <TradeSheet open={sheetOpen && effective !== null} onOpenChange={setSheetOpen}>
          {ticket}
        </TradeSheet>
      )}
    </div>
  );
}
