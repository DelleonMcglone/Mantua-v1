import { binLine, points, reliabilityDots, score, type Metrics } from "./calibration-core.ts";

const SIZE = 220;

/** The reliability diagram: predicted on x, actual on y, the diagonal is perfect. */
export function ReliabilityChart({ m }: { m: Metrics }) {
  const dots = reliabilityDots(m.bins, SIZE);
  return (
    <svg
      viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
      className="h-[220px] w-[220px] shrink-0"
      aria-label="Calibration: predicted probability against actual hit rate"
      data-testid="reliability-chart"
    >
      <rect x={0} y={0} width={SIZE} height={SIZE} fill="none" stroke="var(--border-soft)" />
      <line x1={0} y1={SIZE} x2={SIZE} y2={0} stroke="var(--border-soft)" strokeDasharray="3 4" />
      {dots.map((d) => (
        <circle key={d.label} cx={d.x} cy={d.y} r={d.r} fill="var(--green)" fillOpacity={0.75}>
          <title>{d.label}</title>
        </circle>
      ))}
    </svg>
  );
}

export function ScoreTable({ label, m }: { label: string; m: Metrics }) {
  return (
    <div className="rounded-lg border border-border-soft p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-text-mute">{m.n} scored</span>
      </div>
      <table className="w-full text-xs">
        <thead className="text-text-mute">
          <tr>
            <th className="text-left font-normal">Score</th>
            <th className="text-right font-normal">Agent</th>
            <th className="text-right font-normal">Reference</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Brier (lower is better)</td>
            <td className="text-right tabular-nums">{score(m.agent.brier)}</td>
            <td className="text-right tabular-nums">{score(m.reference.brier)}</td>
          </tr>
          <tr>
            <td>Log loss</td>
            <td className="text-right tabular-nums">{score(m.agent.logLoss)}</td>
            <td className="text-right tabular-nums">{score(m.reference.logLoss)}</td>
          </tr>
          <tr>
            <td>Calibration error</td>
            <td className="text-right tabular-nums" colSpan={2}>
              {points(m.calibrationErrorBps)}
            </td>
          </tr>
          <tr>
            <td>Closing line moved toward the agent</td>
            <td className="text-right tabular-nums" colSpan={2}>
              {m.closingLineValue.n === 0
                ? "—"
                : `${String(m.closingLineValue.towardAgent)} of ${String(m.closingLineValue.n)}`}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function BandList({ m }: { m: Metrics }) {
  const bands = m.bins.filter((b) => b.count > 0);
  if (bands.length === 0)
    return <p className="text-xs text-text-mute">No settled forecasts yet.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {bands.map((b) => (
        <li key={b.fromBps} className="tabular-nums">
          {binLine(b)}
        </li>
      ))}
    </ul>
  );
}

export function SliceTable({ title, slices }: { title: string; slices: Record<string, Metrics> }) {
  const rows = Object.entries(slices);
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-text-mute">Nothing scored yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-text-mute">
            <tr>
              <th className="text-left font-normal">Slice</th>
              <th className="text-right font-normal">n</th>
              <th className="text-right font-normal">Agent Brier</th>
              <th className="text-right font-normal">Reference</th>
              <th className="text-right font-normal">Cal. error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, m]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="text-right tabular-nums">{m.n}</td>
                <td className="text-right tabular-nums">{score(m.agent.brier)}</td>
                <td className="text-right tabular-nums">{score(m.reference.brier)}</td>
                <td className="text-right tabular-nums">{points(m.calibrationErrorBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
