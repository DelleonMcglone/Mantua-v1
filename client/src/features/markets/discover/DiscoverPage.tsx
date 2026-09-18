import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { applyDiscoverFilters, type DiscoverFilters } from "../discovery.ts";
import { describeDiscoverFilters } from "../discovery-query.ts";
import { Freshness } from "../Freshness.tsx";
import { isSportId, type SportId } from "../sports.ts";
import { DiscoverFilterBar } from "./DiscoverFilterBar.tsx";
import { DiscoverRow } from "./DiscoverRow.tsx";
import { useDiscover } from "./use-discover.ts";

interface Props {
  filters: DiscoverFilters;
  onChangeFilters: (next: DiscoverFilters) => void;
  /** A game (and optionally a side) → the league page with the ticket set. */
  onOpenGame: (sport: SportId, eventId: string, side: 0 | 1 | null) => void;
  onBack: () => void;
  /** Phase 11 — the historical market browser. */
  onBrowseHistory?: (() => void) | undefined;
}

/**
 * T-001 / T-018 — market discovery across the covered leagues. One list,
 * one filter object, no market ids: a new sport is a `SPORTS` row plus the
 * server's league allowlist, never a new navigation layer.
 */
export function DiscoverPage({
  filters,
  onChangeFilters,
  onOpenGame,
  onBack,
  onBrowseHistory,
}: Props) {
  const data = useDiscover();
  const rows = useMemo(() => applyDiscoverFilters(data.markets, filters), [data.markets, filters]);
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
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
          <h1 className="text-[28px] font-bold tracking-tight">Markets</h1>
          <p className="mt-1 text-[13px] text-text-dim">
            <span data-testid="discover-title">{describeDiscoverFilters(filters)}</span>
            {!data.loading &&
              ` · ${String(rows.length)} ${rows.length === 1 ? "market" : "markets"}`}
          </p>
          {data.fetchedAt !== undefined && (
            <Freshness
              source={{ fetchedAt: data.fetchedAt, dataAsOf: data.dataAsOf, delayed: data.delayed }}
              className="mt-1"
            />
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <DiscoverFilterBar filters={filters} onChange={onChangeFilters} />
        {onBrowseHistory && (
          <button
            type="button"
            data-testid="browse-history-discover"
            onClick={onBrowseHistory}
            className="text-[12.5px] font-medium text-accent hover:underline cursor-pointer"
          >
            Past markets →
          </button>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-2.5">
        {data.loading && (
          <p role="status" className="text-[13px] text-text-dim">
            Loading markets…
          </p>
        )}
        {data.error && !data.loading && (
          <div className="rounded-md border border-border-soft px-4 py-6 text-center text-[12.5px] text-text-dim">
            Couldn&apos;t reach the markets service. Retrying automatically.
          </div>
        )}
        {!data.loading && !data.error && rows.length === 0 && (
          <div className="rounded-md border border-border-soft px-5 py-10 text-center">
            <p className="text-[14px] font-medium">Nothing matches right now</p>
            <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] text-text-dim">
              Loosen a filter, or try &quot;What can I trade right now?&quot; in the bar below.
            </p>
          </div>
        )}
        {rows.map((m) => (
          <DiscoverRow
            key={`${m.league}-${m.providerEventId}`}
            market={m}
            onOpen={(side) => {
              if (isSportId(m.league)) onOpenGame(m.league, m.providerEventId, side);
            }}
          />
        ))}
      </div>
    </div>
  );
}
