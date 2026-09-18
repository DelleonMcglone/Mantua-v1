import type { HistoryRow } from "../detail/depth-types.ts";
import { historyRowView } from "./history-core.ts";
import { Sparkline } from "./Sparkline.tsx";

const TONE = {
  home: "text-green",
  away: "text-yellow",
  void: "text-text-mute",
  pending: "text-text-dim",
} as const;

/** Phase 11 (D-007) — one resolved market: who played, who won, what a contract paid, and the path. */
export function HistoryRowCard({ row }: { row: HistoryRow }) {
  const v = historyRowView(row);
  return (
    <div
      data-testid="history-row"
      data-tone={v.tone}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border-soft bg-panel-solid px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-text">{v.title}</p>
        <p className="mt-0.5 text-[11.5px] text-text-dim">
          {v.date}
          {v.finalScore && <span className="font-mono"> · {v.finalScore}</span>}
        </p>
      </div>
      <div className="text-right text-[11.5px]">
        <p data-testid="history-outcome" className={`font-medium ${TONE[v.tone]}`}>
          {v.outcome}
        </p>
        {v.settlement && <p className="text-text-dim">{v.settlement}</p>}
        {v.closingPrice && <p className="text-text-mute">closed at {v.closingPrice}</p>}
      </div>
      <Sparkline path={row.path} tone={v.tone} />
    </div>
  );
}
