import { relativeTime } from "@/lib/format.ts";
import type { SlateEvent } from "../use-slate.ts";
import { shortAddr, type DetailResponse } from "./detail-types.ts";

/** Recent trades with the fee each paid (H-011). Deeper data, behind "More". */
export function ActivityTab({
  event,
  detail,
}: {
  event: SlateEvent;
  detail: DetailResponse | null;
}) {
  if (!detail)
    return (
      <p role="status" className="text-[12.5px] text-text-dim">
        Loading activity…
      </p>
    );
  if (detail.activity.length === 0)
    return (
      <p className="text-[12.5px] text-text-dim">
        No trades yet — activity appears here as this market trades.
      </p>
    );
  return (
    <ul className="flex flex-col gap-2">
      {detail.activity.map((a) => {
        const team = a.outcomeIndex === 0 ? event.home : event.away;
        return (
          <li
            key={a.txHash}
            className="flex items-center justify-between rounded-md border border-border-soft px-3.5 py-2.5 text-[12.5px]"
          >
            <div>
              <span className="font-mono text-text-dim">{shortAddr(a.address)}</span>{" "}
              <span className={a.direction === "buy" ? "text-green" : "text-yellow"}>
                {a.direction === "buy" ? "bought" : "sold"}
              </span>{" "}
              {a.tokens.toFixed(2)} {team.abbreviation} contracts
              <span className="text-text-dim"> for ${a.usdc.toFixed(2)}</span>
              {a.feeUsdc !== null && (
                <span className="text-text-dim">
                  {" "}
                  · fee ${a.feeUsdc > 0 ? Math.ceil(a.feeUsdc * 100) / 100 : 0}
                  {a.playoffs === false && " (regular season)"}
                </span>
              )}
            </div>
            {/* P-010/D-104: chainless user UI — the ops surface carries the audit trail. */}
            <div className="text-[11px] text-text-mute">{relativeTime(a.t)}</div>
          </li>
        );
      })}
    </ul>
  );
}
