import { Freshness } from "../Freshness.tsx";
import type { SlateEvent } from "../use-slate.ts";
import type { LiveGame } from "./depth-types.ts";
import { liveGameView } from "./live-game-core.ts";

/**
 * Phase 11 (D-002) — the live game panel: score, period and clock,
 * possession, and the latest play, straight from the sports data layer,
 * with the stamp of the play it was read from. Renders only while the
 * game is in progress; fields the provider did not send are absent.
 */
export function LiveGamePanel({
  league,
  event,
  game,
}: {
  league: string;
  event: SlateEvent;
  game: LiveGame | null;
}) {
  if (!game) return null;
  const v = liveGameView({
    league,
    game,
    home: { key: event.home.key, abbreviation: event.home.abbreviation },
    away: { key: event.away.key, abbreviation: event.away.abbreviation },
  });
  if (!v) return null;
  return (
    <section
      data-testid="live-game"
      aria-label="Live game"
      className="rounded-md border border-green/30 bg-panel-solid p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-green">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" /> Live
        </span>
        {v.score && (
          <span data-testid="live-score" className="font-mono text-[18px] font-semibold text-text">
            {v.score}
          </span>
        )}
        {v.situation && (
          <span data-testid="live-situation" className="font-mono text-[13px] text-text-dim">
            {v.situation}
          </span>
        )}
        {v.possession && (
          <span data-testid="live-possession" className="text-[12px] text-text-dim">
            {v.possession}
          </span>
        )}
        {v.asOf !== null && <Freshness source={{ fetchedAt: v.asOf * 1000 }} className="ml-auto" />}
      </div>
      {v.lastPlay && (
        <p data-testid="live-last-play" className="mt-2 text-[12.5px] text-text-dim">
          Last play: {v.lastPlay}
        </p>
      )}
      {!v.situation && !v.lastPlay && (
        <p className="mt-2 text-[11.5px] text-text-mute">
          Clock and play-by-play appear once the data provider sends them for this game.
        </p>
      )}
    </section>
  );
}
