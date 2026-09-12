import { probabilitySource } from "./probability-source.ts";

/**
 * T-021 — the provenance chip next to any probability: "Market price",
 * "Projection", or "Agent estimate". The user never sees a bare number
 * without knowing where it came from.
 */
export function ProbabilityTag({
  liveOdds,
  model,
  className = "",
}: {
  liveOdds?: boolean | undefined;
  model?: boolean | undefined;
  className?: string;
}) {
  const src = probabilitySource({ liveOdds: Boolean(liveOdds), model: Boolean(model) });
  const tone =
    src.kind === "market"
      ? "bg-accent/15 text-accent"
      : src.kind === "model"
        ? "bg-amber/15 text-amber"
        : "bg-chip text-text-mute";
  return (
    <span
      title={src.detail}
      data-source={src.kind}
      className={`rounded-[3px] px-1 py-px font-mono text-[9px] uppercase tracking-wider ${tone} ${className}`}
    >
      {src.label}
    </span>
  );
}
