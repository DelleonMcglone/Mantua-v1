import { GameRow } from "./GameRow.tsx";
import type { Slate, SlateEvent } from "./use-slate.ts";

interface Selection {
  event: SlateEvent;
  outcomeIndex: 0 | 1;
}

/** The league page's date-grouped game rows with its loading / empty / delayed states. */
export function GamesList({
  label,
  weekLabel,
  slate,
  loading,
  events,
  selected,
  onPick,
  onOpen,
}: {
  label: string;
  weekLabel: string;
  slate: Slate | undefined;
  loading: boolean;
  events: SlateEvent[];
  selected: Selection | null;
  onPick: (event: SlateEvent, outcomeIndex: 0 | 1) => void;
  onOpen: (event: SlateEvent) => void;
}) {
  const groups = new Map<string, SlateEvent[]>();
  for (const event of events) {
    const day = new Date(event.startsAt * 1000).toLocaleDateString(undefined, {
      weekday: "short",
      month: "long",
      day: "numeric",
    });
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  const when =
    weekLabel === "This week"
      ? "this week"
      : weekLabel === "Last week"
        ? "last week"
        : `for ${weekLabel}`;
  return (
    <>
      {loading && !slate && (
        <p role="status" className="text-[13px] text-text-dim">
          Loading games…
        </p>
      )}
      {!loading && events.length === 0 && (
        <div className="rounded-md border border-border-soft px-5 py-10 text-center">
          <p className="text-[14px] font-medium">
            No {label} games {when}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] text-text-dim">
            Off-season or a quiet slate — games and markets appear the moment the schedule does.
          </p>
        </div>
      )}
      {slate?.delayed && (
        <div className="mb-3 rounded-sm border border-yellow/40 bg-yellow/10 px-3 py-1.5 text-[11px] text-yellow">
          Live data is delayed — scores and prices may lag the game.
        </div>
      )}
      {[...groups.entries()].map(([day, dayEvents]) => (
        <section key={day} className="mb-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[16px] font-semibold">{day}</h2>
            <span className="text-[10px] font-medium uppercase tracking-wider text-text-mute">
              Moneyline
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {dayEvents.map((event) => (
              <GameRow
                key={event.providerEventId}
                event={event}
                league={slate?.league ?? ""}
                selected={selected?.event.providerEventId === event.providerEventId}
                selectedOutcome={
                  selected?.event.providerEventId === event.providerEventId
                    ? selected.outcomeIndex
                    : null
                }
                onPick={(outcomeIndex) => {
                  onPick(event, outcomeIndex);
                }}
                onOpen={() => {
                  onOpen(event);
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
