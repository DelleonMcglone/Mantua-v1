import { minutes, type CalibrationReport } from "./calibration-core.ts";
import { useCalibration } from "./use-calibration.ts";
import { BandList, ReliabilityChart, ScoreTable, SliceTable } from "./CalibrationSections.tsx";

/**
 * Task 077 — `/calibration`: how the agent's forecasts score, public. The
 * key comparison is all forecasts against trades only: whether the agent
 * is better at choosing which markets to act on than at forecasting.
 */
export function CalibrationPage({ onBack }: { onBack: () => void }) {
  const { report, error } = useCalibration();
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <button
        type="button"
        className="mb-4 text-xs text-text-mute hover:text-text"
        onClick={onBack}
      >
        ← Mantua
      </button>
      <h1 className="text-xl font-semibold">Forecast calibration</h1>
      <p className="mb-5 text-sm text-text-dim">
        Every probability the agent forms is scored once the market settles, whether or not it
        traded. The reference is the sportsbook line (or the pool price) at the same moment; the
        agent only has an edge if it beats it on the same records.
      </p>
      {error && <p className="text-sm text-red">{error}</p>}
      {!report && !error && <p className="text-sm text-text-dim">Loading…</p>}
      {report && <Report r={report} />}
    </main>
  );
}

function Report({ r }: { r: CalibrationReport }) {
  return (
    <div className="space-y-6">
      <p className="text-xs text-text-mute tabular-nums">
        {r.totals.records} records · {r.totals.views} views · {r.totals.scoreable} scored ·{" "}
        {r.totals.pending} open · {r.totals.voided} voided · {r.totals.afterKickoff} after kickoff
        (excluded)
      </p>
      <section className="flex flex-wrap gap-5">
        <ReliabilityChart m={r.all} />
        <div className="min-w-[200px] flex-1">
          <h2 className="mb-2 text-sm font-semibold">Calibration bands, all forecasts</h2>
          <BandList m={r.all} />
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <ScoreTable label="All forecasts" m={r.all} />
        <ScoreTable label="Trades only" m={r.tradesOnly} />
        <ScoreTable label="Proposed" m={r.proposed} />
        <ScoreTable label="Not proposed" m={r.notProposed} />
      </section>
      <section className="space-y-4">
        <SliceTable title="By league" slices={r.byLeague} />
        <SliceTable title="By horizon before kickoff" slices={r.byHorizon} />
        <SliceTable title="By liquidity at forecast time" slices={r.byLiquidity} />
        <SliceTable title="By confidence label" slices={r.byConfidence} />
        <SliceTable title="By model version" slices={r.byModelVersion} />
      </section>
      <section>
        <h2 className="mb-1 text-sm font-semibold">Human in the loop</h2>
        <p className="text-xs tabular-nums">
          {r.hitl.proposals} proposals · {r.hitl.approved} approved · {r.hitl.rejected} rejected ·{" "}
          {r.hitl.unfilled} unfilled · {r.hitl.pending} pending · approval rate{" "}
          {r.hitl.approvalRate === null ? "—" : `${(r.hitl.approvalRate * 100).toFixed(0)}%`} ·
          median time to approve {minutes(r.hitl.medianTimeToApproveMs)}, to reject{" "}
          {minutes(r.hitl.medianTimeToRejectMs)}
        </p>
      </section>
      <section>
        <h2 className="mb-1 text-sm font-semibold">
          Autonomy readiness · rules {r.readiness.rulesVersion} ·{" "}
          {r.readiness.passing ? "passing" : "not yet"}
        </h2>
        <ul className="space-y-1 text-xs">
          {r.readiness.rules.map((s) => (
            <li key={s.rule}>
              <span className={s.passing ? "text-green" : "text-text-mute"}>
                {s.passing ? "✓" : "✗"}
              </span>{" "}
              {s.rule} — {s.detail}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-text-mute">
          Readiness is reported, never acted on: the auto-execute cap stays where the user set it.
          {r.readiness.nextCapUsdc !== null &&
            ` The rules would unlock the next step, ${String(r.readiness.nextCapUsdc)} USDC.`}
        </p>
      </section>
    </div>
  );
}
