import type { ChartRange } from "./types.ts";

const RANGES: ChartRange[] = ["7D", "30D", "90D", "1Y", "ALL"];
const METRICS = ["tvl", "apy"] as const;

export type Metric = (typeof METRICS)[number];

export function RangeToggle({
  value,
  onChange,
}: {
  value: ChartRange;
  onChange: (r: ChartRange) => void;
}) {
  return (
    <div className="inline-flex bg-bg-elev rounded-full p-0.5 border border-border-soft">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => {
            onChange(r);
          }}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            value === r ? "bg-chip text-text" : "text-text-dim hover:text-text"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

export function MetricToggle({
  value,
  onChange,
}: {
  value: Metric;
  onChange: (m: Metric) => void;
}) {
  return (
    <div className="inline-flex bg-bg-elev rounded-full p-0.5 border border-border-soft">
      {METRICS.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => {
            onChange(m);
          }}
          className={`px-3 py-1 text-xs font-medium uppercase rounded-full transition-colors ${
            value === m ? "bg-chip text-text" : "text-text-dim hover:text-text"
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
