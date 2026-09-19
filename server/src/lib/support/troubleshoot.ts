import { SIGN_IN, tradePendingFlow, tradeRefusedFlow, transferFlow } from "./troubleshoot-flows.ts";

/**
 * Task 070 / AE-009 — deterministic troubleshooting flows: the model picks
 * the issue, the steps come from here, keyed on the platform status and
 * the user's own state, so equal situations get equal answers.
 */

export const TROUBLESHOOT_ISSUES = [
  "deposit_pending",
  "withdraw_pending",
  "trade_pending",
  "trade_refused",
  "confirm_not_working",
  "agent_unavailable",
  "voice_unavailable",
  "balance_missing",
] as const;
export type TroubleshootIssue = (typeof TROUBLESHOOT_ISSUES)[number];

export interface TroubleshootContext {
  platform: { mode: string; trading: string; reads: string; message: string | null } | null;
  /** Null for an anonymous conversation. */
  account: {
    pendingTransfers: number;
    failedTransfers: number;
    pendingTrades: number;
    hasAgentWallet: boolean;
    agentMode: string;
    lastFailure: string | null;
  } | null;
}

export interface TroubleshootResult {
  issue: TroubleshootIssue;
  steps: string[];
  /** The flow ends in a human: the model should offer escalation. */
  escalate: boolean;
}

const KEYWORDS: readonly [TroubleshootIssue, RegExp][] = [
  ["deposit_pending", /deposit|add funds|top ?up/i],
  ["withdraw_pending", /withdraw|cash ?out|payout/i],
  ["confirm_not_working", /confirm/i],
  ["trade_refused", /refus|rejected|declin|blocked|halt/i],
  ["trade_pending", /pending|stuck|not (showing|executed)|still processing/i],
  ["agent_unavailable", /agent (is )?(down|unavailable|not (responding|working))/i],
  ["voice_unavailable", /voice|microphone|mic\b/i],
  ["balance_missing", /balance|missing|where('s| is) my/i],
];

/** Best-effort issue detection from the user's words; null when unsure. */
export function detectIssue(text: string): TroubleshootIssue | null {
  for (const [issue, re] of KEYWORDS) if (re.test(text)) return issue;
  return null;
}

/** The steps for one issue, in the order to try them. */
export function troubleshoot(
  issue: TroubleshootIssue,
  ctx: TroubleshootContext,
): TroubleshootResult {
  const a = ctx.account;
  switch (issue) {
    case "deposit_pending":
      return { issue, ...transferFlow("deposit", a) };
    case "withdraw_pending":
      return { issue, ...transferFlow("withdrawal", a) };
    case "trade_pending":
      return { issue, ...tradePendingFlow(ctx) };
    case "trade_refused":
      return { issue, ...tradeRefusedFlow(ctx) };
    case "confirm_not_working":
      return {
        issue,
        steps: [
          'Reply with the word "confirm" in a typed message after the agent shows a preview; a spoken message can never confirm.',
          "A preview expires after ten minutes; ask for a fresh preview if it has been longer.",
          ...(a?.agentMode === "simulation"
            ? ["The agent is in simulation mode: nothing executes, by design."]
            : []),
        ],
        escalate: false,
      };
    case "agent_unavailable":
      return {
        issue,
        steps: [
          a?.agentMode === "disabled"
            ? "The agent is disabled on this deployment."
            : "Check the status banner; the agent pauses when the platform is paused.",
          a && !a.hasAgentWallet
            ? "Your agent wallet is not provisioned yet; open the Agent page to create it."
            : "Reload and try one read-only question, such as your balance.",
        ],
        escalate: a?.agentMode !== "disabled",
      };
    case "voice_unavailable":
      return {
        issue,
        steps: [
          "Allow microphone access for this site in the browser, then reload.",
          "If the button is not shown at all, voice is not enabled on this deployment; typing works the same way.",
        ],
        escalate: false,
      };
    case "balance_missing":
      return {
        issue,
        steps: [
          a
            ? "Your balances are on the portfolio panel; the agent's wallet is separate from yours."
            : SIGN_IN,
          "A deposit that is still pending is not in the balance yet; a redeemed win arrives as USDC.",
        ],
        escalate: false,
      };
  }
}
