export type SafetyErrorCode =
  | "spending_cap_exceeded"
  | "spending_cap_hard_ceiling"
  | "slippage_too_high"
  | "kill_switch_active"
  | "wrong_chain"
  | "wallet_unknown";

export class SafetyError extends Error {
  public readonly code: SafetyErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(code: SafetyErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SafetyError";
    this.code = code;
    this.details = details;
  }
}
