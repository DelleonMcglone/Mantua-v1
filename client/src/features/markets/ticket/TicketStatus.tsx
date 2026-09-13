import { Banner } from "@/components/ui/banner.tsx";
import { BASE_CHAIN_ID, getExplorerTxUrl } from "@/lib/chains.ts";
import type { TradeErrorCopy } from "../trade-errors.ts";
import type { TradePhase } from "../use-market-trade.ts";
import type { TradeTicketModel } from "./use-trade-ticket.ts";

/**
 * In-flight copy and the error banner (T-012). Wallet prompts are named
 * as prompts, never as transactions; every failure has a title, a body,
 * and — where retrying makes sense — one action. Phase 7 / R-004: a trade
 * with a hash whose receipt is late reads as "still confirming", never as
 * a failure, and trades from earlier sessions report their outcome here.
 * The verification link is neutral (PF-018) — it never names a chain.
 */
export function TicketStatus({
  phase,
  error,
  earlier,
  onRetry,
  onFund,
  onLogin,
}: {
  phase: TradePhase;
  error: TradeErrorCopy | null;
  earlier: TradeTicketModel["earlier"];
  onRetry: () => void;
  onFund: () => void;
  onLogin: () => void;
}) {
  return (
    <>
      <CurrentStatus
        phase={phase}
        error={error}
        onRetry={onRetry}
        onFund={onFund}
        onLogin={onLogin}
      />
      <EarlierTrades earlier={earlier} />
    </>
  );
}

function ViewLink({ hash }: { hash: `0x${string}` }) {
  return (
    <a
      href={getExplorerTxUrl(BASE_CHAIN_ID, hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
    >
      View transaction
    </a>
  );
}

function CurrentStatus({
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
  if (
    phase.kind === "building" ||
    phase.kind === "approving" ||
    phase.kind === "signing" ||
    phase.kind === "confirming"
  ) {
    return (
      <p role="status" className="mt-2 text-[12px] text-accent">
        {phase.kind === "building" && "Preparing your trade…"}
        {phase.kind === "approving" && "Approve in your wallet…"}
        {phase.kind === "signing" && "Confirm in your wallet…"}
        {phase.kind === "confirming" && (
          <>
            Placing your trade… <ViewLink hash={phase.txHash} />
          </>
        )}
      </p>
    );
  }
  if (phase.kind === "pending") {
    return (
      <p role="status" className="mt-2 text-[12px] text-yellow" data-testid="trade-pending">
        Submitted and still confirming — this is taking longer than usual. We keep checking; you can
        leave this page. <ViewLink hash={phase.txHash} />
      </p>
    );
  }
  if (!error) return null;
  const act = error.action;
  return (
    <div className="mt-2" data-testid="trade-error" data-error-kind={error.kind}>
      <Banner tone={error.kind === "declined" ? "info" : "warn"} title={error.title}>
        {error.body}
        {phase.kind === "failed" && (
          <>
            {" "}
            <ViewLink hash={phase.txHash} />
          </>
        )}
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

function EarlierTrades({ earlier }: { earlier: TradeTicketModel["earlier"] }) {
  if (earlier.pending.length === 0 && earlier.settled.length === 0) return null;
  return (
    <div
      className="mt-2 flex flex-col gap-1 text-[11px] leading-relaxed text-text-dim"
      data-testid="earlier-trades"
    >
      {earlier.pending.map((t) => (
        <span key={t.txHash} role="status">
          An earlier {t.direction} is still confirming
          {earlier.slow ? " — taking longer than usual" : ""}. <ViewLink hash={t.txHash} />
        </span>
      ))}
      {earlier.settled.map((s) => (
        <span
          key={s.trade.txHash}
          role="status"
          className={s.outcome === "confirmed" ? "text-green" : "text-yellow"}
        >
          {s.outcome === "confirmed" && "An earlier trade went through."}
          {s.outcome === "failed" && "An earlier trade didn't go through — nothing was traded."}
          {s.outcome === "dropped" &&
            "An earlier trade was never placed — nothing was traded."}{" "}
          <ViewLink hash={s.trade.txHash} />{" "}
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => {
              earlier.dismiss(s.trade.txHash);
            }}
          >
            Dismiss
          </button>
        </span>
      ))}
    </div>
  );
}
