import { PREDICTION_NOTE } from "./probability-source.ts";

/**
 * T-022 — the standing line under any agent or analysis output. Rendered
 * wherever a model's view of a game appears so no prediction reads as a
 * certainty.
 */
export function PredictionNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[10.5px] leading-relaxed text-text-mute ${className}`}>{PREDICTION_NOTE}</p>
  );
}
