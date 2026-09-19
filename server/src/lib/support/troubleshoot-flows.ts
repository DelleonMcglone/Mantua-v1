import type { TroubleshootContext } from "./troubleshoot.ts";

/**
 * Task 070 / AE-009 — the money flows of the troubleshooter: transfers
 * (deposit / withdrawal) and trades (pending / refused), keyed on the
 * caller's own account and the platform status. `troubleshoot.ts` holds
 * the issue catalogue and the simpler flows.
 */

type Account = NonNullable<TroubleshootContext["account"]>;
export interface Flow {
  steps: string[];
  escalate: boolean;
}

export const SIGN_IN =
  "Sign in so I can check your own account; anonymous chats see only general steps.";

export function transferFlow(kind: "deposit" | "withdrawal", a: Account | null): Flow {
  if (!a) {
    return {
      steps: [SIGN_IN, `A bank ${kind} usually completes within 1–3 business days.`],
      escalate: false,
    };
  }
  if (a.failedTransfers > 0) {
    return {
      steps: [
        `A recent transfer failed${a.lastFailure ? `: ${a.lastFailure}` : "."}`,
        "Open Profile → transfers to see whether it can be retried or needs support.",
      ],
      escalate: true,
    };
  }
  if (a.pendingTransfers > 0) {
    return {
      steps: [
        `You have ${String(a.pendingTransfers)} pending transfer(s). A bank ${kind} usually completes within 1–3 business days; the status updates on its own.`,
        "If it has been more than 3 business days, I can escalate it with the reference from your transfers list.",
      ],
      escalate: false,
    };
  }
  return {
    steps: [
      `No pending ${kind} is on your account. If you sent USDC on chain, check the transaction on the destination address; on-chain transfers appear once confirmed.`,
    ],
    escalate: false,
  };
}

/** The banner line when trading is not open, else null. */
export function tradingHalted(ctx: TroubleshootContext): string | null {
  const p = ctx.platform;
  if (!p || p.trading === "open") return null;
  return p.message ?? `Trading is currently ${p.trading.replace("_", " ")}.`;
}

export function tradePendingFlow(ctx: TroubleshootContext): Flow {
  const a = ctx.account;
  const halted = tradingHalted(ctx);
  const steps = halted ? [halted] : [];
  const pending = a !== null && a.pendingTrades > 0;
  if (pending) {
    steps.push(
      `You have ${String(a.pendingTrades)} trade(s) awaiting chain confirmation. This usually takes under a minute; the ticket updates from the server's own verification.`,
      "If it has been more than 10 minutes, I can escalate it with the transaction hash.",
    );
  } else
    steps.push(a ? "No trade is pending on your account; refresh the position list." : SIGN_IN);
  return { steps, escalate: pending };
}

export function tradeRefusedFlow(ctx: TroubleshootContext): Flow {
  const halted = tradingHalted(ctx);
  return {
    steps: halted
      ? [halted, "Sells stay open while buys are halted; buys resume when the feed is current."]
      : [
          "A refusal names its reason on the ticket: a stale price, a spending cap, a policy limit, or insufficient balance.",
          "Re-simulate the trade to get a fresh price, then confirm again.",
        ],
    escalate: false,
  };
}
