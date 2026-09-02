import type { HookOption } from "./hook-types.ts";

interface FeeArchitectureProps {
  /** LP fee tier in pips (1 pip = 0.0001%). */
  lpFeePips?: number;
  /** Active hook — drives the Hook Fee row label + value. */
  hook: HookOption;
  /** Hook-specific fee in pips. Optional — defaults to 0 for "none". */
  hookFeePips?: number;
}

/**
 * P5-009 — fee breakdown shown in the swap modal. Mirrors the
 * design's "FEE ARCHITECTURE" block: LP fee + hook fee on separate
 * rows so users can see exactly where each basis point of the price
 * impact comes from.
 */
export function FeeArchitecture({ lpFeePips, hook, hookFeePips }: FeeArchitectureProps) {
  const lpDisplay = lpFeePips !== undefined ? `${(lpFeePips / 10_000).toFixed(4)}%` : "—";
  const hookDisplay =
    hook === "none"
      ? "0.00%"
      : hookFeePips !== undefined
        ? `${(hookFeePips / 10_000).toFixed(4)}%`
        : "Dynamic";

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold tracking-[0.12em] text-text-mute uppercase">
        Fee Architecture
      </div>
      <dl className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-text-dim">LP Fee</dt>
          <dd className="font-mono">{lpDisplay}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-dim">Hook Fee</dt>
          <dd className="font-mono">{hookDisplay}</dd>
        </div>
      </dl>
    </div>
  );
}
