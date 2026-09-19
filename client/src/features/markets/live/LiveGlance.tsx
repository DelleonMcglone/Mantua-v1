import { usePrivy } from "@privy-io/react-auth";
import { useMemo } from "react";
import { useMarketPositions } from "@/features/portfolio/use-market-positions.ts";
import type { SlateEvent } from "../use-slate.ts";
import { glanceRows, usd, type GlanceRow } from "./live-glance-core.ts";

/**
 * Task 071 (MX-003) — scores, your positions and prices in one glanceable
 * surface. One card per game in progress; the games you hold come first
 * and carry the exit: "Sell" opens the ticket on Sell with the full
 * balance, so leaving a live position is two taps (Sell → Confirm). Tapping
 * the card opens the market page.
 */
export function LiveGlance({
  events,
  onOpen,
  className = "",
}: {
  events: readonly SlateEvent[];
  onOpen: (eventId: string) => void;
  className?: string;
}) {
  const { user } = usePrivy();
  const { rows: positions } = useMarketPositions(user?.wallet?.address ?? null);
  const rows = useMemo(() => glanceRows(events, positions), [events, positions]);
  if (rows.length === 0) return null;
  return (
    <section
      aria-label="Live now"
      data-testid="live-glance"
      className={`flex flex-col gap-2 ${className}`}
    >
      {rows.map((row) => (
        <GlanceCard key={row.eventId} row={row} onOpen={onOpen} />
      ))}
    </section>
  );
}

function GlanceCard({ row, onOpen }: { row: GlanceRow; onOpen: (eventId: string) => void }) {
  const { event } = row;
  return (
    <div
      data-testid="glance-row"
      className="rounded-md border border-green/30 bg-panel-solid px-3 py-2.5"
    >
      <button
        type="button"
        onClick={() => {
          onOpen(row.eventId);
        }}
        aria-label={`Open ${event.away.name} at ${event.home.name}`}
        className="flex min-h-11 w-full items-center gap-2 bg-transparent text-left cursor-pointer"
      >
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-green">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" /> Live
        </span>
        <span data-testid="glance-score" className="font-mono text-[16px] font-semibold text-text">
          {row.score ?? `${event.away.abbreviation} at ${event.home.abbreviation}`}
        </span>
        <span data-testid="glance-prices" className="ml-auto font-mono text-[12px] text-text-dim">
          {row.priceCents.away !== null &&
            `${event.away.abbreviation} ${String(row.priceCents.away)}¢`}
          {row.priceCents.away !== null && row.priceCents.home !== null && " · "}
          {row.priceCents.home !== null &&
            `${event.home.abbreviation} ${String(row.priceCents.home)}¢`}
        </span>
      </button>
      {row.positions.map((p) => (
        <div
          key={p.side}
          data-testid="glance-position"
          className="mt-1 flex items-center gap-2 border-t border-border-soft pt-2 text-[12.5px]"
        >
          <span className="min-w-0 flex-1 truncate">
            You hold <span className="font-mono text-text">{p.contracts.toFixed(2)}</span>{" "}
            {p.abbreviation}
            {p.priceCents !== null && (
              <>
                {" "}
                · now <span className="font-mono text-text">{String(p.priceCents)}¢</span>
              </>
            )}{" "}
            · ≈ <span className="font-mono text-text">{usd(p.valueUsd)}</span>
            {p.pnlUsd !== null && (
              <span className={`ml-1 font-mono ${p.pnlUsd >= 0 ? "text-green" : "text-red"}`}>
                ({p.pnlUsd >= 0 ? "+" : ""}
                {usd(p.pnlUsd)})
              </span>
            )}
          </span>
          {p.close && (
            <button
              type="button"
              data-testid="glance-sell"
              aria-label={`Sell your ${p.team} position`}
              onClick={() => {
                window.dispatchEvent(new CustomEvent("mantua:close-position", { detail: p.close }));
              }}
              className="inline-flex min-h-11 shrink-0 items-center rounded-md bg-chip px-4 text-[13px] font-semibold text-text hover:bg-accent/25 cursor-pointer"
            >
              {p.pnlUsd !== null && p.pnlUsd > 0 ? "Lock in" : "Sell"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
