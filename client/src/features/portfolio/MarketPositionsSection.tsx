import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { LineChart } from "lucide-react";
import { api } from "@/lib/api.ts";

interface PositionRow {
  marketId: string;
  label: string;
  state: string;
  side: "yes" | "no";
  balance: string;
  impliedProbBps: number | null;
  valueRaw: string;
  league: string | null;
  providerEventId: string | null;
  entryPriceBps: number | null;
  pnlRaw: string | null;
}

/**
 * B6-009 — live market positions, marked at the pool price. Balance ×
 * current implied probability = what the position is worth right now;
 * a winning side converges to 1.00, a losing one to 0. Entry price and
 * realized P&L arrive with indexed trade history.
 */
export function MarketPositionsSection() {
  const { user } = usePrivy();
  const address = user?.wallet?.address;
  const [rows, setRows] = useState<PositionRow[] | null>(null);

  const reload = useCallback(() => {
    if (!address) return;
    api
      .get<{ positions: PositionRow[] }>(`/api/markets/positions?address=${address}`)
      .then((res) => {
        setRows(res.positions);
      })
      .catch(() => {
        setRows([]);
      });
  }, [address]);

  useEffect(() => {
    reload();
    window.addEventListener("mantua:refresh-portfolio", reload);
    return () => {
      window.removeEventListener("mantua:refresh-portfolio", reload);
    };
  }, [reload]);

  return (
    <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
        <LineChart className="h-3.5 w-3.5" /> Market positions
      </h3>
      {rows === null ? (
        <p className="mt-1.5 text-[12.5px] text-text-dim">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
          None yet — hit Trade on any matchup to take a position. Holdings show here marked at the
          live pool price.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {rows.map((row) => {
            const tokens = Number(row.balance) / 1e6;
            const value = Number(row.valueRaw) / 1e6;
            return (
              <li
                key={`${row.marketId}-${row.side}`}
                className="rounded-sm border border-border-soft px-2.5 py-2 text-[12px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                  <span
                    className={`rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                      row.side === "yes" ? "bg-green/15 text-green" : "bg-chip text-text-mute"
                    }`}
                  >
                    {row.side}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-text-dim">
                  <span className="font-mono">{tokens.toFixed(2)} tokens</span>
                  <span>
                    {row.impliedProbBps !== null && (
                      <span className="mr-2 font-mono">
                        {(row.impliedProbBps / 100).toFixed(0)}%
                      </span>
                    )}
                    <span className="font-mono text-text">≈ {value.toFixed(2)} USDC</span>
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-text-mute">
                    {row.state}
                    {row.entryPriceBps !== null && (
                      <span className="ml-2 normal-case tracking-normal">
                        entry {(row.entryPriceBps / 100).toFixed(1)}%
                      </span>
                    )}
                    {row.pnlRaw !== null && (
                      <span
                        className={`ml-2 font-mono normal-case tracking-normal ${
                          Number(row.pnlRaw) >= 0 ? "text-green" : "text-yellow"
                        }`}
                      >
                        {Number(row.pnlRaw) >= 0 ? "+" : ""}
                        {(Number(row.pnlRaw) / 1e6).toFixed(2)} P&L
                      </span>
                    )}
                  </span>
                  {row.side === "yes" &&
                    row.league &&
                    row.providerEventId &&
                    row.state === "OPEN" && (
                      <button
                        type="button"
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent("mantua:close-position", {
                              detail: { league: row.league, eventId: row.providerEventId },
                            }),
                          );
                        }}
                        className="rounded-sm border border-border-soft px-2 py-0.5 text-[10px] text-text-dim hover:text-text cursor-pointer"
                      >
                        Close
                      </button>
                    )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
