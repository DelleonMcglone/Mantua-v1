import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useLiveBalance } from "@/features/portfolio/use-live-balance.ts";
import { usePlatformStatus } from "@/features/status/PlatformStatusProvider.tsx";
import { buysBlockedByStatus } from "@/features/status/connection-status-core.ts";
import { feeExceedsCeiling, feeLines, type FeeLine } from "../fee-lines.ts";
import { feeSummary } from "../market-trade-core.ts";
import { usePendingTrades } from "../PendingTradesProvider.tsx";
import {
  describeTradeError,
  insufficientBalanceError,
  revertedTradeError,
  type TradeErrorCopy,
} from "../trade-errors.ts";
import {
  initialTicket,
  needsFunding,
  tapTicket,
  ticketReadiness,
  type Side,
  type TicketState,
  type TicketTap,
} from "../trade-ticket-core.ts";
import { useMarketTrade, type TradeQuote } from "../use-market-trade.ts";
import type { SlateEvent } from "../use-slate.ts";
import { useContractBalance } from "./use-contract-balance.ts";

export interface TradeTicketArgs {
  event: SlateEvent;
  outcomeIndex: Side;
  initialDirection?: "buy" | "sell" | undefined;
  initialAmount?: string | undefined;
}

/**
 * The ticket's brain: the tap machine (`trade-ticket-core.ts`) drives the
 * step, `useMarketTrade` quotes and executes, the shared live balance
 * decides funding, and every failure passes through `describeTradeError`.
 * The component only renders what this returns.
 *
 * Phase 7 folded in: the re-quote keeps the last numbers on screen
 * (R-003), a trade with a hash is `confirming` → `pending` / `done` /
 * `failed` and never ambiguous (R-004), trades from earlier sessions still
 * settling come from the pending register, and an operator pause disables
 * buys with its own button state (R-005).
 */
export function useTradeTicket({
  event,
  outcomeIndex,
  initialDirection,
  initialAmount,
}: TradeTicketArgs) {
  const { authenticated } = usePrivy();
  const [ticket, setTicket] = useState<TicketState>(() => ({
    ...initialTicket(),
    step: "amount",
    side: outcomeIndex,
    direction: initialDirection ?? "buy",
    amount: initialAmount ?? "0",
  }));
  const [fundingOpen, setFundingOpen] = useState(false);
  const [fundingSkipped, setFundingSkipped] = useState(false);
  const balance = useLiveBalance();
  const register = usePendingTrades();
  const { status: platformStatus } = usePlatformStatus();

  const { phase, execute } = useMarketTrade({
    eventId: event.providerEventId,
    outcomeIndex,
    direction: ticket.direction,
    amount: ticket.amount,
    enabled: authenticated,
  });

  // The execution outcome is derived, not synced: while the machine says
  // "executing", the trade hook's phase decides executed vs. failed. A
  // `pending` trade (receipt late, register still asking) stays executing —
  // it is not a failure.
  const step: TicketState["step"] =
    ticket.step === "executing"
      ? phase.kind === "done"
        ? "executed"
        : phase.kind === "error" || phase.kind === "failed"
          ? "error"
          : "executing"
      : ticket.step;

  // What the ticket renders: the (cap-free) quote while the user is
  // choosing — the previous one during a re-quote — and the issued
  // calldata's own quote once the trade has a hash.
  const view: TradeQuote | null =
    phase.kind === "quoted" || phase.kind === "building"
      ? phase.quote
      : phase.kind === "quoting"
        ? phase.previous
        : phase.kind === "approving" ||
            phase.kind === "signing" ||
            phase.kind === "confirming" ||
            phase.kind === "pending" ||
            phase.kind === "done" ||
            phase.kind === "failed"
          ? phase.calldata
          : null;
  const contractBalance = useContractBalance(view?.yesToken, phase.kind);

  const quote = view?.quote ?? null;
  const fee = view?.fee ?? null;
  const ceilingBroken = fee ? feeExceedsCeiling(fee) : false;
  const summary = quote && fee && !ceilingBroken ? feeSummary(quote.amountIn, fee) : null;
  const lines: FeeLine[] = summary ? feeLines(summary, ticket.direction) : [];
  const funding = quote ? needsFunding(ticket.direction, quote.amountIn, balance.usdcRaw) : false;
  const paused = ticket.direction === "buy" && buysBlockedByStatus(platformStatus);
  const readiness = ticketReadiness({
    authenticated,
    quoted: phase.kind === "quoted" && !ceilingBroken,
    funding: funding && !fundingSkipped,
    paused,
  });
  const busy =
    phase.kind === "building" ||
    phase.kind === "approving" ||
    phase.kind === "signing" ||
    phase.kind === "confirming";

  let error: TradeErrorCopy | null = null;
  if (ceilingBroken) {
    error = {
      kind: "quote",
      title: "Fee quote out of range",
      body: "The fee quote came back above the 0.70% ceiling, which cannot happen on a healthy market. Try again in a moment.",
      action: { label: "Try again", kind: "retry" },
    };
  } else if (phase.kind === "error") {
    error = describeTradeError(phase.error);
  } else if (phase.kind === "failed") {
    error = revertedTradeError();
  } else if (fundingSkipped && funding && quote && balance.usdcRaw !== null) {
    error = insufficientBalanceError(quote.amountIn, balance.usdcRaw);
  }

  // Trades from this or an earlier session still settling, minus the one
  // this ticket is showing (R-004).
  const currentHash =
    phase.kind === "confirming" ||
    phase.kind === "pending" ||
    phase.kind === "done" ||
    phase.kind === "failed"
      ? phase.txHash.toLowerCase()
      : null;
  const earlier = {
    pending: register.pending.filter((t) => t.txHash.toLowerCase() !== currentHash),
    settled: register.settled.filter((s) => s.trade.txHash.toLowerCase() !== currentHash),
    slow: register.slow,
    dismiss: register.dismiss,
  };

  const tap = (t: TicketTap) => {
    setTicket((s) => tapTicket(s, t));
    if (t.kind === "reset" || t.kind === "type" || t.kind === "preset") setFundingSkipped(false);
  };

  const confirm = () => {
    if (readiness === "fund") {
      setFundingOpen(true);
      return;
    }
    if (readiness !== "ready") return;
    tap({ kind: "confirm" });
    void execute();
  };

  return {
    ticket: { ...ticket, step },
    tap,
    confirm,
    readiness,
    busy,
    phase,
    quote,
    summary,
    lines,
    error,
    earlier,
    authenticated,
    balanceRaw: balance.usdcRaw,
    contractBalance,
    funding: {
      open: fundingOpen,
      close: () => {
        setFundingOpen(false);
      },
      skip: () => {
        setFundingOpen(false);
        setFundingSkipped(true);
      },
    },
  };
}

export type TradeTicketModel = ReturnType<typeof useTradeTicket>;
