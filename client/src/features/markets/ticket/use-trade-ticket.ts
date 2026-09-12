import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useLiveBalance } from "@/features/portfolio/use-live-balance.ts";
import { feeExceedsCeiling, feeLines, type FeeLine } from "../fee-lines.ts";
import { feeSummary } from "../market-trade-core.ts";
import {
  describeTradeError,
  insufficientBalanceError,
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
import { useMarketTrade, type TradeCalldata } from "../use-market-trade.ts";
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

  const { phase, execute } = useMarketTrade({
    eventId: event.providerEventId,
    outcomeIndex,
    direction: ticket.direction,
    amount: ticket.amount,
    enabled: authenticated,
  });

  // The execution outcome is derived, not synced: while the machine says
  // "executing", the trade hook's phase decides executed vs. failed.
  const step: TicketState["step"] =
    ticket.step === "executing"
      ? phase.kind === "done"
        ? "executed"
        : phase.kind === "error"
          ? "error"
          : "executing"
      : ticket.step;

  const calldata: TradeCalldata | null =
    phase.kind === "quoted" || phase.kind === "done" ? phase.calldata : null;
  const contractBalance = useContractBalance(calldata?.yesToken, phase.kind);

  const quote = calldata?.quote ?? null;
  const fee = calldata?.fee ?? null;
  const ceilingBroken = fee ? feeExceedsCeiling(fee) : false;
  const summary = quote && fee && !ceilingBroken ? feeSummary(quote.amountIn, fee) : null;
  const lines: FeeLine[] = summary ? feeLines(summary, ticket.direction) : [];
  const funding = quote ? needsFunding(ticket.direction, quote.amountIn, balance.usdcRaw) : false;
  const readiness = ticketReadiness({
    authenticated,
    quoted: phase.kind === "quoted" && !ceilingBroken,
    funding: funding && !fundingSkipped,
  });
  const busy =
    phase.kind === "approving" || phase.kind === "signing" || phase.kind === "confirming";

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
  } else if (fundingSkipped && funding && quote && balance.usdcRaw !== null) {
    error = insufficientBalanceError(quote.amountIn, balance.usdcRaw);
  }

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
