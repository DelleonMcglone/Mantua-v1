import { Droplet, History } from "lucide-react";
import { usd as fmtUsd } from "@/lib/format.ts";
import { settledLine, settledOutcome } from "./portfolio-core.ts";
import type { UsePortfolioEconomics } from "./use-portfolio-economics.ts";

/**
 * Phase 9 / PF-002, PF-007, PF-009, PF-012 — the money views behind the
 * portfolio: every LP position's deposited basis, current value, accrued
 * fees, P&L and pool share (null shown as "unknown", never as zero), the
 * realized sports-market results, and the settled-position history.
 */

const TONE: Record<"win" | "loss" | "void", string> = {
  win: "bg-green/15 text-green",
  loss: "bg-red/15 text-red",
  void: "bg-chip text-text-mute",
};

function signed(n: number): string {
  return `${n >= 0 ? "+" : "−"}${fmtUsd(Math.abs(n))}`;
}

export function LpEconomicsSection({ econ }: { econ: UsePortfolioEconomics }) {
  const e = econ.economics;
  return (
    <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
        <Droplet className="h-3.5 w-3.5" /> Liquidity economics
      </h3>
      {econ.error && <p className="mt-1.5 text-[12.5px] text-red">{econ.error}</p>}
      {!econ.error && e === null && (
        <p className="mt-1.5 text-[12.5px] text-text-dim">
          {econ.loading ? "Loading…" : "Connect a wallet."}
        </p>
      )}
      {e && e.lp.length === 0 && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
          No liquidity positions on-chain. Add liquidity to a pool to see deposited basis, fees and
          P&L here.
        </p>
      )}
      {e && e.lp.length > 0 && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
            <Stat label="Value" value={fmtUsd(e.lpTotals.currentValueUsd)} />
            <Stat label="Deposited" value={fmtUsd(e.lpTotals.depositedUsd)} />
            <Stat label="Fees accrued" value={fmtUsd(e.lpTotals.accruedFeesUsd)} />
            <Stat
              label="P&L"
              value={signed(e.lpTotals.pnlUsd)}
              tone={e.lpTotals.pnlUsd >= 0 ? "text-green" : "text-red"}
            />
          </div>
          {e.lpTotals.withoutBasis > 0 && (
            <p className="mt-1 text-[11px] text-text-mute">
              {String(e.lpTotals.withoutBasis)} position{e.lpTotals.withoutBasis === 1 ? "" : "s"}{" "}
              opened outside Mantua — no deposit basis, P&L not counted.
            </p>
          )}
          <ul className="mt-2 flex flex-col gap-1.5">
            {e.lp.map((p) => (
              <li
                key={p.tokenId}
                className="rounded-sm border border-border-soft px-2.5 py-2 text-[12px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {p.pair}
                    <span className="ml-1.5 font-mono text-[10px] text-text-mute">
                      {(p.fee / 10_000).toFixed(2)}%
                    </span>
                    {p.hook && <span className="ml-1.5 text-[10px] text-text-mute">{p.hook}</span>}
                  </span>
                  <span className="font-mono text-text">{fmtUsd(p.currentValueUsd)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-text-dim">
                  <span>
                    deposited {p.depositedUsd === null ? "unknown" : fmtUsd(p.depositedUsd)}
                  </span>
                  <span>fees {fmtUsd(p.accruedFeesUsd)}</span>
                  <span
                    className={p.pnlUsd === null ? "" : p.pnlUsd >= 0 ? "text-green" : "text-red"}
                  >
                    P&L{" "}
                    {p.pnlUsd === null
                      ? "unknown"
                      : `${signed(p.pnlUsd)}${p.pnlPct === null ? "" : ` (${p.pnlPct.toFixed(1)}%)`}`}
                  </span>
                  <span>
                    share{" "}
                    {p.liquidityShareBps === null
                      ? "unknown"
                      : `${(p.liquidityShareBps / 100).toFixed(2)}%`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {e && (
        <div className="mt-3 border-t border-border-soft pt-2 text-[11px] text-text-dim">
          Markets realized:{" "}
          <span
            className={`font-mono ${e.realized.marketRealizedPnlUsd >= 0 ? "text-green" : "text-red"}`}
          >
            {signed(e.realized.marketRealizedPnlUsd)}
          </span>
          {e.realized.marketWinRate !== null && (
            <span className="ml-2">· {(e.realized.marketWinRate * 100).toFixed(0)}% win rate</span>
          )}
          <span className="ml-2">· {String(e.realized.resolvedMarkets)} resolved</span>
          <span className="ml-2">
            · LP fees collected:{" "}
            {e.realized.lpCollectedUsd === null
              ? "not tracked yet"
              : fmtUsd(e.realized.lpCollectedUsd)}
          </span>
        </div>
      )}
    </section>
  );
}

export function SettledPositionsSection({ econ }: { econ: UsePortfolioEconomics }) {
  const s = econ.settled;
  return (
    <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
        <History className="h-3.5 w-3.5" /> Settled positions
      </h3>
      {s === null && (
        <p className="mt-1.5 text-[12.5px] text-text-dim">
          {econ.loading ? "Loading…" : "Connect a wallet."}
        </p>
      )}
      {s && s.rows.length === 0 && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
          No resolved markets yet. Once a game you traded settles, its realized result shows here.
        </p>
      )}
      {s && s.rows.length > 0 && (
        <>
          <div className="mt-1.5 text-[11px] text-text-dim">
            {String(s.totals.wins)}W · {String(s.totals.losses)}L
            {s.totals.voided > 0 ? ` · ${String(s.totals.voided)} void` : ""} · realized{" "}
            <span
              className={`font-mono ${s.totals.realizedPnlUsd >= 0 ? "text-green" : "text-red"}`}
            >
              {signed(s.totals.realizedPnlUsd)}
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {s.rows.map((r) => {
              const o = settledOutcome(r);
              return (
                <li
                  key={r.marketId}
                  className="rounded-sm border border-border-soft px-2.5 py-2 text-[12px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                    <span
                      className={`rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] uppercase ${TONE[o.tone]}`}
                    >
                      {o.label}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-text-dim">
                    <span className="font-mono">{settledLine(r)}</span>
                    <span>{o.tone === "win" ? (r.redeemed ? "claimed" : "claimable") : ""}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-text-mute">{label}</div>
      <div className={`font-mono text-[13px] ${tone ?? "text-text"}`}>{value}</div>
    </div>
  );
}
