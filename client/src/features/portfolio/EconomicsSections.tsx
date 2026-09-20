import { History } from "lucide-react";
import { usd as fmtUsd } from "@/lib/format.ts";
import { settledLine, settledOutcome } from "./portfolio-core.ts";
import type { UsePortfolioEconomics } from "./use-portfolio-economics.ts";

/**
 * Phase 9 / PF-007, PF-012 — the money views behind the portfolio: the
 * realized sports-market results and the settled-position history.
 */

const TONE: Record<"win" | "loss" | "void", string> = {
  win: "bg-green/15 text-green",
  loss: "bg-red/15 text-red",
  void: "bg-chip text-text-mute",
};

function signed(n: number): string {
  return `${n >= 0 ? "+" : "−"}${fmtUsd(Math.abs(n))}`;
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
