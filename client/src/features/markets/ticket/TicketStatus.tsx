import { Banner } from "@/components/ui/banner.tsx";
import type { TradeErrorCopy } from "../trade-errors.ts";
import type { TradePhase } from "../use-market-trade.ts";

/**
 * In-flight copy and the error banner (T-012). Wallet prompts are named
 * as prompts, never as transactions; every failure has a title, a body,
 * and — where retrying makes sense — one action.
 */
export function TicketStatus({
  phase,
  error,
  onRetry,
  onFund,
  onLogin,
}: {
  phase: TradePhase;
  error: TradeErrorCopy | null;
  onRetry: () => void;
  onFund: () => void;
  onLogin: () => void;
}) {
  if (phase.kind === "approving" || phase.kind === "signing" || phase.kind === "confirming") {
    return (
      <p role="status" className="mt-2 text-[12px] text-accent">
        {phase.kind === "approving" && "Approve in your wallet…"}
        {phase.kind === "signing" && "Confirm in your wallet…"}
        {phase.kind === "confirming" && "Placing your trade…"}
      </p>
    );
  }
  if (!error) return null;
  const act = error.action;
  return (
    <div className="mt-2" data-testid="trade-error" data-error-kind={error.kind}>
      <Banner tone={error.kind === "declined" ? "info" : "warn"} title={error.title}>
        {error.body}
        {act && (
          <button
            type="button"
            onClick={act.kind === "fund" ? onFund : act.kind === "login" ? onLogin : onRetry}
            className="ml-2 rounded-sm border border-border-soft px-2 py-0.5 text-[11px] text-text hover:border-accent cursor-pointer"
          >
            {act.label}
          </button>
        )}
      </Banner>
    </div>
  );
}
