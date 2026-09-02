import {
  DEFAULT_SLIPPAGE_BPS,
  DOUBLE_CONFIRM_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  WARNING_SLIPPAGE_BPS,
} from "./constants.ts";
import { SafetyError } from "./errors.ts";

export type SlippageWarning = "ok" | "warn" | "double_confirm";

/**
 * P1-004 — assert a user-supplied slippage (bps) is within bounds. Hard
 * rejects above MAX_SLIPPAGE_BPS (5%). Returns the level the caller should
 * surface in the UI: `ok` (≤ default), `warn` (default..1%), or
 * `double_confirm` (1%..5%).
 */
export function classifySlippage(bps: number): SlippageWarning {
  if (!Number.isFinite(bps) || bps < 0) {
    throw new SafetyError("slippage_too_high", "Slippage must be a non-negative finite number.", {
      bps,
    });
  }
  if (bps > MAX_SLIPPAGE_BPS) {
    throw new SafetyError(
      "slippage_too_high",
      `Slippage ${String(bps)} bps exceeds the hard cap of ${String(MAX_SLIPPAGE_BPS)} bps (5%).`,
      { bps, max: MAX_SLIPPAGE_BPS },
    );
  }
  if (bps <= DEFAULT_SLIPPAGE_BPS) return "ok";
  if (bps < WARNING_SLIPPAGE_BPS) return "warn";
  // WARNING_SLIPPAGE_BPS == DOUBLE_CONFIRM_SLIPPAGE_BPS == 100 — anything ≥ 1%
  // up to MAX_SLIPPAGE_BPS requires double-confirmation.
  void DOUBLE_CONFIRM_SLIPPAGE_BPS;
  return "double_confirm";
}

/**
 * Convenience wrapper — call when you don't care about the warning level,
 * just whether the value is acceptable. Throws SafetyError if not.
 */
export function assertSlippageBounds(bps: number): void {
  classifySlippage(bps);
}
