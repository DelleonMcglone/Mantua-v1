/**
 * Hard-coded safety constants. Lifting any of these requires a code change
 * and redeploy — no runtime / admin path can exceed them.
 */

/**
 * Network gate. Mantua runs on **Base Mainnet** — `MANTUA_NETWORK`
 * defaults to `mainnet`. The `testnet` branch of the enum is retained so
 * the shared IS_MAINNET guard keeps compiling, but there is no supported
 * testnet target.
 */
export const NETWORK = process.env.MANTUA_NETWORK === "testnet" ? "testnet" : "mainnet";
export const IS_MAINNET = NETWORK === "mainnet";
export const IS_TESTNET = NETWORK === "testnet";

/** The single active chain id (Base Mainnet). */
export const ACTIVE_CHAIN_ID: number = 8453;

// Spending caps — USD equivalent.
// (D-009 ACCEPTED: $500 default, tiered raise by account age, $50k absolute ceiling.)
export const DEFAULT_DAILY_CAP_USD = 500;
export const HARD_DAILY_CAP_USD = 50_000;
export const DEFAULT_AGENT_DAILY_CAP_USD = 100;

// Tier thresholds in days since first connection.
export const TIER_RAISE_DAYS = {
  earlyMax: 30, //  0–30:  capped at $500, user can lower only
  midMax: 90, // 31–90:  user can raise to $10k with double-confirmation
} as const;

export const TIER_CAPS_USD = {
  early: 500,
  mid: 10_000,
  full: 50_000,
} as const;

// Slippage (bps).
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
export const WARNING_SLIPPAGE_BPS = 100; // 1.0% — show warning
export const DOUBLE_CONFIRM_SLIPPAGE_BPS = 100; // 1–5% — double-confirm
export const MAX_SLIPPAGE_BPS = 500; // 5.0% — hard reject above

// Mantua fee (bps). D-010 ACCEPTED: 10 default, MAX_FEE_BPS=25.
export const DEFAULT_FEE_BPS = 10;
export const MAX_FEE_BPS = 25;
