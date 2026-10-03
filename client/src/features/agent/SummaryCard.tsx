import { usd } from "@/lib/format.ts";

export interface SummaryRow {
  game: string;
  team: string;
  priceBps: number | null;
  moveTodayPoints: number | null;
  rating: string;
  rationale: string;
}

const FAIR_CLASS = "bg-chip border-border-soft text-text-dim";
const RATING_CLASS: Record<string, string> = {
  "Lean YES": "bg-green/10 border-green/35 text-green",
  "Lean NO": "bg-red/10 border-red/35 text-red",
  Fair: FAIR_CLASS,
  Thin: "bg-yellow/10 border-yellow/40 text-yellow",
  "No price": "bg-chip border-border-soft text-text-mute",
};

/**
 * The research turn's Summary card: one row per game and side with the
 * price, the day's move, a rating pill and one line of rationale. The
 * header carries the budget when the user stated one.
 */
export function SummaryCard({
  budgetUsdc,
  rows,
}: {
  budgetUsdc: number | null;
  rows: SummaryRow[];
}) {
  return (
    <div data-testid="summary-card" className="flex flex-col gap-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-mute">
        Summary{budgetUsdc !== null ? ` · ${usd(budgetUsdc)} to put to work` : ""}
      </div>
      {rows.length === 0 && (
        <div className="text-[12.5px] text-text-dim">No priced markets to compare.</div>
      )}
      {rows.map((r) => (
        <div key={`${r.game}-${r.team}`} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[14px] font-semibold">{r.team}</span>
            <span className="font-mono text-[13px]">
              {r.priceBps === null ? "—" : `${(r.priceBps / 100).toFixed(0)}¢`}
            </span>
            {r.moveTodayPoints !== null && (
              <span
                className={`font-mono text-[12px] ${r.moveTodayPoints >= 0 ? "text-green" : "text-red"}`}
              >
                {r.moveTodayPoints >= 0 ? "+" : ""}
                {r.moveTodayPoints.toFixed(1)} pts today
              </span>
            )}
            <span
              className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium ${RATING_CLASS[r.rating] ?? FAIR_CLASS}`}
            >
              {r.rating}
            </span>
          </div>
          <div className="text-[12px] text-text-dim">
            {r.game} — {r.rationale}
          </div>
        </div>
      ))}
    </div>
  );
}
