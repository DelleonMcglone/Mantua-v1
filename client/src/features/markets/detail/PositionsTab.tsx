import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api } from "@/lib/api.ts";
import { closePositionDetail } from "../market-trade-core.ts";
import type { SlateEvent } from "../use-slate.ts";
import type { PositionRow } from "./detail-types.ts";

/**
 * Your positions in this market, marked live. Close (or "Lock in profit"
 * when ahead) is tap one of the two-tap exit (T-011): it deep-links the
 * ticket onto a pre-filled full-balance sell.
 */
export function PositionsTab({ event }: { event: SlateEvent }) {
  const { authenticated, user } = usePrivy();
  const address = user?.wallet?.address;
  const [rows, setRows] = useState<PositionRow[] | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const load = () => {
      api
        .get<{ positions: PositionRow[] }>(`/api/markets/positions?address=${address}`)
        .then((res) => {
          if (!cancelled)
            setRows(res.positions.filter((p) => p.providerEventId === event.providerEventId));
        })
        .catch(() => {
          if (!cancelled) setRows([]);
        });
    };
    load();
    // T-007: refresh on every fill and on a slow poll.
    window.addEventListener("mantua:refresh-portfolio", load);
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("mantua:refresh-portfolio", load);
    };
  }, [address, event.providerEventId]);

  if (!authenticated) {
    return (
      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(new Event("mantua:open-login"));
        }}
        className="w-full rounded-md border border-border-soft px-3 py-2 text-[12.5px] text-text-dim hover:text-text cursor-pointer"
      >
        Log in to see your positions in this market
      </button>
    );
  }
  if (rows === null)
    return (
      <p role="status" className="text-[12.5px] text-text-dim">
        Loading positions…
      </p>
    );
  if (rows.length === 0)
    return (
      <p className="text-[12.5px] text-text-dim">
        No position in this market yet — use the ticket to take one.
      </p>
    );

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((p) => {
        const tokens = Number(p.balance) / 1e6;
        const value = Number(p.valueRaw) / 1e6;
        const pnl = p.pnlRaw === null ? null : Number(p.pnlRaw) / 1e6;
        const close = closePositionDetail(p);
        return (
          <li
            key={p.marketId}
            className="flex items-center justify-between gap-3 rounded-md border border-border-soft px-3.5 py-2.5 text-[13px]"
          >
            <div>
              <div className="font-medium">{p.label}</div>
              <div className="text-[11px] text-text-dim">
                {tokens.toFixed(2)} contracts
                {p.entryPriceBps !== null &&
                  ` · avg entry ${String(Math.round(p.entryPriceBps / 100))}¢`}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-mono">${value.toFixed(2)}</div>
                {pnl !== null && (
                  <div
                    className={`font-mono text-[11px] ${pnl >= 0 ? "text-green" : "text-yellow"}`}
                  >
                    {pnl >= 0 ? "+" : ""}
                    {pnl.toFixed(2)}
                  </div>
                )}
              </div>
              {close && (
                <button
                  type="button"
                  data-testid="close-position"
                  aria-label={`Close position — sell ${tokens.toFixed(2)} ${p.label} contracts`}
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("mantua:close-position", { detail: close }),
                    );
                  }}
                  className={`rounded-sm border px-2 py-1 text-[11px] cursor-pointer ${
                    pnl !== null && pnl > 0
                      ? "border-green/50 text-green hover:bg-green/10"
                      : "border-border-soft text-text-dim hover:text-text"
                  }`}
                >
                  {pnl !== null && pnl > 0 ? "Lock in profit" : "Close"}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
