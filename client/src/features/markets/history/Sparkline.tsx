import { sparklinePoints } from "./history-core.ts";

const W = 120;
const H = 32;

/** Phase 11 (D-007) — a resolved market's home-side price path, at a glance. */
export function Sparkline({
  path,
  tone,
}: {
  path: readonly { t: number; priceBps: number }[];
  tone: "home" | "away" | "void" | "pending";
}) {
  const points = sparklinePoints(path, W, H);
  if (!points) return <span className="text-[10.5px] text-text-mute">no price path</span>;
  const stroke =
    tone === "home"
      ? "var(--green)"
      : tone === "away"
        ? "var(--yellow)"
        : tone === "void"
          ? "var(--text-mute)"
          : "var(--text-dim)";
  return (
    <svg
      data-testid="history-sparkline"
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      className="h-8 w-[120px] shrink-0"
      preserveAspectRatio="none"
      aria-label="Price path"
    >
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--border-soft)" strokeDasharray="2 4" />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}
