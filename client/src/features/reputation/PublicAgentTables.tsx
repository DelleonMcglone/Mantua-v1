import { marketRows, modeRows, type PublicAgent } from "./reputation-core.ts";

/**
 * Task 070 / AE-012, AE-013, AE-014 — the two tables of the public page:
 * the breakdown by execution mode, and the full market record. Losses
 * are never filtered: this is the record.
 */

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border-soft px-4 py-3.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">{title}</h3>
      {note && <p className="mt-1 mb-2.5 text-[12px] text-text-dim">{note}</p>}
      {children}
    </section>
  );
}

const TH = "font-medium py-1";

export function ModeBreakdown({ agent }: { agent: PublicAgent }) {
  return (
    <Section
      title="By execution mode"
      note="Simulated entries never enter P&L. A market whose fills span two modes is counted under neither."
    >
      <table className="w-full text-[13px]">
        <thead className="text-[11px] uppercase tracking-wider text-text-mute">
          <tr>
            <th className={`text-left ${TH}`}>Mode</th>
            <th className={`text-right ${TH}`}>Trades</th>
            <th className={`text-right ${TH}`}>Staked</th>
            <th className={`text-right ${TH}`}>Realised</th>
            <th className={`text-right ${TH}`}>Note</th>
          </tr>
        </thead>
        <tbody>
          {modeRows(agent).map((r) => (
            <tr key={r.mode} className="border-t border-border-soft">
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right font-mono">{r.trades}</td>
              <td className="py-1.5 text-right font-mono">{r.staked}</td>
              <td className="py-1.5 text-right font-mono">{r.realized}</td>
              <td className="py-1.5 text-right text-text-dim">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {agent.ledger.mixedMarkets > 0 && (
        <p className="mt-2 text-[12px] text-text-dim">
          {agent.ledger.mixedMarkets} resolved market(s) mixed modes.
        </p>
      )}
    </Section>
  );
}

const RESULT_TONE = { resolved_win: "text-green", resolved_loss: "text-red", voided: "", open: "" };

export function MarketRecord({ agent }: { agent: PublicAgent }) {
  const rows = marketRows(agent);
  return (
    <Section
      title="Every market"
      note={`${String(rows.length)} market(s), ${String(agent.ledger.trades.length)} chain-verified fills. Nothing is omitted.`}
    >
      {rows.length === 0 ? (
        <p className="text-[13px] text-text-dim">No trades yet.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead className="text-[11px] uppercase tracking-wider text-text-mute">
            <tr>
              <th className={`text-left ${TH}`}>Market</th>
              <th className={`text-left ${TH}`}>Result</th>
              <th className={`text-left ${TH}`}>Mode</th>
              <th className={`text-right ${TH}`}>Staked</th>
              <th className={`text-right ${TH}`}>P&L</th>
              <th className={`text-right ${TH}`}>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.marketId} className="border-t border-border-soft">
                <td className="py-1.5 font-mono text-[12px]">{m.marketId.slice(0, 10)}…</td>
                <td className={`py-1.5 ${RESULT_TONE[m.status]}`}>{m.statusLabel}</td>
                <td className="py-1.5 text-text-dim">{m.modes.join(", ").replace(/_/g, " ")}</td>
                <td className="py-1.5 text-right font-mono">${m.costUsd.toFixed(2)}</td>
                <td className="py-1.5 text-right font-mono">{m.result}</td>
                <td className="py-1.5 text-right text-text-dim">
                  {(m.resolvedAt ?? m.lastTradeAt).slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
