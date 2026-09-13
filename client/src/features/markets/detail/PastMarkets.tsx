import { HistoryRowCard } from "../history/HistoryRowCard.tsx";
import { useMarketHistory } from "../history/use-market-history.ts";

/**
 * Phase 12 (D-007) — the Past markets section on a market page: the last
 * few resolved games in this league, and the way into the full browser.
 */
export function PastMarkets({
  league,
  onBrowseHistory,
}: {
  league: string;
  onBrowseHistory: () => void;
}) {
  const h = useMarketHistory(league, 5);
  return (
    <div data-testid="past-markets" className="flex flex-col gap-2.5">
      {h.loading && (
        <p role="status" className="text-[12.5px] text-text-dim">
          Loading past markets…
        </p>
      )}
      {!h.loading && h.failed && (
        <p className="text-[12.5px] text-text-dim">Past markets are unavailable right now.</p>
      )}
      {!h.loading && !h.failed && h.rows.length === 0 && (
        <p className="text-[12.5px] text-text-dim">
          No resolved markets in this league yet — the first appears after a game settles.
        </p>
      )}
      {h.rows.map((row) => (
        <HistoryRowCard key={`${row.league}:${row.providerEventId}`} row={row} />
      ))}
      <button
        type="button"
        data-testid="browse-history"
        onClick={onBrowseHistory}
        className="self-start text-[12.5px] font-medium text-accent hover:underline cursor-pointer"
      >
        Browse all past markets →
      </button>
    </div>
  );
}
