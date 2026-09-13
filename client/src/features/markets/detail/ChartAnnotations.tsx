import { annotationSummary, type PlacedAnnotation } from "./chart-annotations.ts";

const TONE: Record<PlacedAnnotation["kind"], string> = {
  kickoff: "text-text",
  period: "text-text-dim",
  frozen: "text-amber",
  resolved: "text-accent",
  injury: "text-yellow",
};

/**
 * Phase 12 (D-005) — the label strip under the price chart, one marker
 * per annotation at the same x as its guide line in the SVG. HTML rather
 * than SVG text so labels keep their aspect when the chart stretches.
 */
export function ChartAnnotations({
  placed,
  width,
}: {
  placed: readonly PlacedAnnotation[];
  width: number;
}) {
  const summary = annotationSummary(placed);
  if (placed.length === 0 || summary === null) return null;
  return (
    <div data-testid="chart-annotations" className="mt-1">
      <div className="relative h-7">
        {placed.map((a) => (
          <span
            key={`${a.kind}-${String(a.t)}`}
            data-testid="chart-annotation"
            data-kind={a.kind}
            title={new Date(a.t * 1000).toLocaleString()}
            className={`absolute whitespace-nowrap text-[9.5px] leading-none ${TONE[a.kind]}`}
            style={{ left: `${String((a.x / width) * 100)}%`, top: a.lane === 0 ? 0 : 14 }}
          >
            <span aria-hidden="true" className="mr-0.5">
              ▲
            </span>
            {a.label}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-text-mute">{summary}</p>
    </div>
  );
}

/** The guide lines inside the SVG, drawn at each annotation's x. */
export function AnnotationLines({
  placed,
  height,
}: {
  placed: readonly PlacedAnnotation[];
  height: number;
}) {
  return (
    <g>
      {placed.map((a) => (
        <line
          key={`${a.kind}-${String(a.t)}`}
          x1={a.x}
          x2={a.x}
          y1={0}
          y2={height}
          stroke="var(--text-mute)"
          strokeDasharray="2 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}
