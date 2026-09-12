/**
 * Phase 8 / A-028, A-029 — the agent's trading mode, a SERVER setting.
 *
 * The specification defines four modes and mandates "Always Ask" as the
 * initial configuration. The mode is read from `AGENT_MODE` at boot and
 * never from the model, the user's message, or a tool argument — so no
 * instruction the agent receives can move it.
 *
 *   disabled      the agent endpoint refuses (503 AGENT_DISABLED)
 *   simulation    every money-moving tool is refused with a typed result;
 *                 previews and simulations still run so the flow can be
 *                 rehearsed end to end with nothing at stake
 *   user_testing  (default) every money-moving action requires a fresh
 *                 preview/simulation AND an explicit confirmation from the
 *                 user's own message, minted into a single-use confirmation
 *                 id that the execution must present (A-031)
 *   autonomous    the future mode: execution without a per-action
 *                 confirmation, still behind a fresh simulation, the daily
 *                 cap, the policy layer and the kill switch. Reaching it
 *                 requires BOTH this server flag and the user's
 *                 `agent_policies.auto_trade_enabled`; until user testing
 *                 (A-043…A-046) signs off it should stay unset.
 */

export const AGENT_MODES = ["disabled", "simulation", "user_testing", "autonomous"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export const DEFAULT_AGENT_MODE: AgentMode = "user_testing";

export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && (AGENT_MODES as readonly string[]).includes(value);
}

export interface ModePolicy {
  /** The endpoint answers at all. */
  enabled: boolean;
  /** Money-moving tools may reach execution (after the gate). */
  writesAllowed: boolean;
  /** A money-moving tool must present a confirmation id minted from the
   *  user's own explicit confirmation. */
  confirmationRequired: boolean;
  /** Human line for the model's per-turn context. */
  summary: string;
}

export function modePolicy(mode: AgentMode): ModePolicy {
  switch (mode) {
    case "disabled":
      return {
        enabled: false,
        writesAllowed: false,
        confirmationRequired: true,
        summary: "The agent is disabled.",
      };
    case "simulation":
      return {
        enabled: true,
        writesAllowed: false,
        confirmationRequired: true,
        summary:
          "SIMULATION mode: you may preview and simulate, but no money-moving tool will execute — every execution returns a simulation-only result. Say so plainly when the user asks to trade.",
      };
    case "user_testing":
      return {
        enabled: true,
        writesAllowed: true,
        confirmationRequired: true,
        summary:
          "USER-TESTING mode (Always Ask): every money-moving action needs (1) a preview or simulation you show the user, then (2) the user's explicit confirmation in their own next message, which the server turns into a confirmation id. You may only execute when this turn's context carries that id. Never execute on your own initiative.",
      };
    case "autonomous":
      return {
        enabled: true,
        writesAllowed: true,
        confirmationRequired: false,
        summary:
          "AUTONOMOUS mode: for users whose policy enables auto-trading you may execute after a fresh simulation without a per-action confirmation; for everyone else the user-testing rules apply.",
      };
  }
}
