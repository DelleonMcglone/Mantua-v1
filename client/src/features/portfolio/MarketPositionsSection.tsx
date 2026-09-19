import { usePrivy } from "@privy-io/react-auth";
import { LineChart } from "lucide-react";
import { closePositionDetail } from "@/features/markets/market-trade-core.ts";
import { groupPositionsByGame, payoutLine } from "./portfolio-core.ts";
import { useMarketPositions } from "./use-market-positions.ts";

/**
 * B6-009 — live market positions, marked at the pool price. Balance ×
 * current implied probability = what the position is worth right now;
 * a winning side converges to 1.00, a losing one to 0. Phase 9 / PF-003:
 * grouped by game, each row with its entry, unrealized P&L and what it
 * pays at par if it wins. `address` defaults to the signed-in wallet; the
 * agent tab passes the agent's (PF-005).
 */
export function MarketPositionsSection({
  address: addressProp,
  title = "Market positions",
}: {
  address?: string | null;
  title?: string;
} = {}) {
  const { user } = usePrivy();
  const address = addressProp ?? user?.wallet?.address ?? null;
  const { rows } = useMarketPositions(address);
  const groups = rows ? groupPositionsByGame(rows) : [];

  return (
    <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
        <LineChart className="h-3.5 w-3.5" /> {title}
      </h3>
      {rows === null ? (
        <p className="mt-1.5 text-[12.5px] text-text-dim">{address ? "Loading…" : "No wallet."}</p>
      ) : rows.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
          None yet — hit Trade on any matchup to take a position. Holdings show here marked at the
          live pool price.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2.5">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center justify-between text-[11px] text-text-mute">
                <span>
                  {g.label}
                  {g.league ? ` · ${g.league.toUpperCase()}` : ""}
                </span>
                <span className="font-mono">
                  ≈ {g.valueUsd.toFixed(2)} · pays up to {g.potentialPayoutUsd.toFixed(2)}
                </span>
              </div>
              <ul className="mt-1 flex flex-col gap-1.5">
                {g.rows.map((row) => {
                  const tokens = Number(row.balance) / 1e6;
                  const value = Number(row.valueRaw) / 1e6;
                  const close = closePositionDetail(row);
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
                        <span className="font-mono">{tokens.toFixed(2)} contracts</span>
                        <span>
                          {row.impliedProbBps !== null && (
                            <span className="mr-2 font-mono">
                              {(row.impliedProbBps / 100).toFixed(0)}%
                            </span>
                          )}
                          <span className="font-mono text-text">≈ ${value.toFixed(2)}</span>
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
                          <span className="ml-2 normal-case tracking-normal">
                            {payoutLine(row)}
                          </span>
                        </span>
                        {close && (
                          <button
                            type="button"
                            aria-label={`Close position — sell ${tokens.toFixed(2)} ${row.label} tokens`}
                            onClick={() => {
                              // One-click Close (B7-003): deep-links the league page
                              // sidebar onto a Sell pre-filled with the full balance.
                              window.dispatchEvent(
                                new CustomEvent("mantua:close-position", { detail: close }),
                              );
                            }}
                            className="min-h-11 rounded-sm border border-border-soft px-3 py-0.5 text-[12px] text-text-dim hover:text-text cursor-pointer md:min-h-0 md:px-2 md:text-[10px]"
                          >
                            {row.pnlRaw !== null && Number(row.pnlRaw) > 0
                              ? "Lock in profit"
                              : "Close"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
