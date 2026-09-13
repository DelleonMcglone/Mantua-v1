import type { SlateEvent } from "../use-slate.ts";
import { shortAddr, type DetailResponse } from "./detail-types.ts";

/** Top holders per side — deeper data, behind the market page's "More". */
export function HoldersTab({
  event,
  detail,
}: {
  event: SlateEvent;
  detail: DetailResponse | null;
}) {
  if (!detail)
    return (
      <p role="status" className="text-[12.5px] text-text-dim">
        Loading holders…
      </p>
    );
  const sides = [0, 1].map((idx) => ({
    idx,
    team: idx === 0 ? event.home : event.away,
    data: detail.holders.find((h) => h.outcomeIndex === idx),
  }));
  const any = sides.some((s) => (s.data?.holders.length ?? 0) > 0);
  if (!any) {
    return (
      <p className="text-[12.5px] text-text-dim">
        No holders yet — positions appear here once this market trades.
      </p>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sides.map(({ idx, team, data }) => (
        <div key={idx} className="rounded-md border border-border-soft p-3.5">
          <h4 className="mb-2 text-[12px] font-semibold">{team.name} contracts</h4>
          {data && data.holders.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {data.holders.map((h) => (
                <li key={h.address} className="flex items-center justify-between text-[12px]">
                  <span className="font-mono text-text-dim">
                    {h.label ?? shortAddr(h.address)}
                    {h.isContract ? " (pool)" : ""}
                  </span>
                  <span className="font-mono text-text">{h.pctOfSupply.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-text-dim">No holders yet.</p>
          )}
        </div>
      ))}
    </div>
  );
}
