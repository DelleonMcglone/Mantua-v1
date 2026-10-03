import type { TroubleshootContext } from "./troubleshoot.ts";

/**
 * Task 070 / AE-009 — the money flows of the troubleshooter: USDC
 * deposits / withdrawals and trades (pending / refused), keyed on the
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
  const onChain =
    kind === "deposit"
      ? "A USDC deposit lands as soon as the transfer confirms on the Arc network, usually within seconds. If it has not appeared, check that it was sent on Arc — funds sent on another network cannot be recovered — and that the address matches the one on your Profile page."
      : "A USDC withdrawal confirms on chain within seconds. Check the transaction on the destination address; once confirmed it cannot be reversed.";
  if (!a) return { steps: [SIGN_IN, onChain], escalate: false };
  return { steps: [onChain], escalate: false };
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
