import { usePrivy } from "@privy-io/react-auth";
import { Layers } from "lucide-react";
import { LEG_LABELS, STATUS_LABELS, verdictLine, type ComboTicket } from "./combo-ticket-core.ts";
import { useCombos } from "./use-combos.ts";

/**
 * Task 072 / CB-008 — combos as first-class positions on the profile: each
 * ticket with its legs and their results, the stake, the live mark, the
 * P&L, and what it pays if every leg wins. Nothing is hidden by outcome:
 * won, lost, void and sold tickets stay in the list.
 */
export function ComboPositionsSection({
  onOpenBuilder,
}: {
  onOpenBuilder?: (() => void) | undefined;
}) {
  const { authenticated } = usePrivy();
  const { tickets } = useCombos(authenticated);
  return (
    <section
      data-testid="combo-positions"
      className="mt-3 rounded-md border border-border-soft px-4 py-3.5"
    >
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
        <Layers className="h-3.5 w-3.5" /> Combos
      </h3>
      {!authenticated || tickets === null ? (
        <p className="mt-1.5 text-[12.5px] text-text-dim">
          {authenticated ? "Loading…" : "Log in to see your combos."}
        </p>
      ) : tickets.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
          None yet — tap <span className="font-medium text-text">+ Combo</span> on two or more teams
          to build one.{" "}
          {onOpenBuilder && (
            <button type="button" onClick={onOpenBuilder} className="underline cursor-pointer">
              Open the builder
            </button>
          )}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {tickets.map((t) => (
            <TicketRow key={t.id} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TicketRow({ t }: { t: ComboTicket }) {
  const stake = Number(t.stakeRaw) / 1e6;
  const pays = Number(t.potentialPayoutRaw) / 1e6;
  const value = t.valueRaw === null ? null : Number(t.valueRaw) / 1e6;
  const pnl = t.pnlRaw === null ? null : Number(t.pnlRaw) / 1e6;
  const settled =
    t.settlementPrice !== null ? (Number(t.sharesRaw) / 1e6) * t.settlementPrice : null;
  return (
    <li className="rounded-sm border border-border-soft px-2.5 py-2 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
        <span className="rounded-[3px] bg-chip px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-mute">
          {STATUS_LABELS[t.status] ?? t.status}
        </span>
      </div>
      <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-text-dim">
        {t.legs.map((l) => (
          <li key={l.marketId} className="flex justify-between">
            <span>
              {l.label}
              {l.opponent ? ` over ${l.opponent}` : ""}
            </span>
            <span
              className={`font-mono ${l.result === "won" ? "text-green" : l.result === "lost" ? "text-yellow" : ""}`}
            >
              {LEG_LABELS[l.result]}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center justify-between text-[11px] text-text-dim">
        <span>{verdictLine(t)}</span>
        <span className="font-mono">
          stake ${stake.toFixed(2)} ·{" "}
          {t.combinedOdds === null ? "" : `${String(t.combinedOdds)}x · `}pays ${pays.toFixed(2)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[11px]">
        <span className="text-text-mute">
          {t.source === "agent" ? "built by your agent" : "built by you"}
        </span>
        {settled !== null ? (
          <span className="font-mono text-text">settled ${settled.toFixed(2)}</span>
        ) : value !== null ? (
          <span className="font-mono">
            <span className="text-text">≈ ${value.toFixed(2)}</span>
            {pnl !== null && (
              <span className={`ml-2 ${pnl >= 0 ? "text-green" : "text-yellow"}`}>
                {pnl >= 0 ? "+" : ""}
                {pnl.toFixed(2)} P&L
              </span>
            )}
          </span>
        ) : (
          <span className="text-text-mute">unmarked</span>
        )}
      </div>
    </li>
  );
}
