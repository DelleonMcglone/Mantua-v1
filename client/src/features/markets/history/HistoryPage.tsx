import { ArrowLeft } from "lucide-react";
import { Chip } from "../discover/FilterChip.tsx";
import { Freshness } from "../Freshness.tsx";
import { SPORTS, type SportId } from "../sports.ts";
import { HistoryRowCard } from "./HistoryRowCard.tsx";
import { useMarketHistory } from "./use-market-history.ts";

interface Props {
  league: SportId | null;
  onChangeLeague: (league: SportId | null) => void;
  onBack: () => void;
}

/**
 * Phase 12 (D-007) — the historical market browser: every resolved market
 * with its final score, outcome, settlement, and price path, filtered by
 * league. Reachable from any market page's Past markets section and from
 * Discover; never needs a market id.
 */
export function HistoryPage({ league, onChangeLeague, onBack }: Props) {
  const h = useMarketHistory(league, 50);
  const leagues = SPORTS.filter((s) => s.coverage === "launch");
  return (
    <div data-testid="history-page" className="mx-auto w-full max-w-4xl px-6 py-6">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="mt-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-soft bg-transparent text-text-dim transition-colors hover:text-text cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Past markets</h1>
          <p className="mt-1 text-[13px] text-text-dim">
            How earlier games resolved and what their contracts paid.
            {!h.loading &&
              ` · ${String(h.rows.length)} ${h.rows.length === 1 ? "market" : "markets"}`}
          </p>
          {h.fetchedAt !== undefined && (
            <Freshness source={{ fetchedAt: h.fetchedAt }} className="mt-1" />
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Chip
          value="all"
          active={league === null}
          label="All leagues"
          onPick={() => {
            onChangeLeague(null);
          }}
        />
        {leagues.map((s) => (
          <Chip
            key={s.id}
            value={s.id}
            active={league === s.id}
            label={s.label}
            onPick={(id) => {
              onChangeLeague(id);
            }}
          />
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-2.5">
        {h.loading && (
          <p role="status" className="text-[13px] text-text-dim">
            Loading past markets…
          </p>
        )}
        {h.failed && (
          <p role="alert" className="text-[13px] text-text-dim">
            Past markets are unavailable right now.
          </p>
        )}
        {!h.loading && !h.failed && h.rows.length === 0 && (
          <p className="text-[13px] text-text-dim">No resolved markets yet for this selection.</p>
        )}
        {h.rows.map((row) => (
          <HistoryRowCard key={`${row.league}:${row.providerEventId}`} row={row} />
        ))}
      </div>
    </div>
  );
}
