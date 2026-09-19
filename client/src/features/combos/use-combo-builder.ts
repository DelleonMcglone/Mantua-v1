import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { describeTradeError, revertedTradeError } from "@/features/markets/trade-errors.ts";
import { needsFunding, ticketReadiness } from "@/features/markets/trade-ticket-core.ts";
import { useLiveBalance } from "@/features/portfolio/use-live-balance.ts";
import { usePlatformStatus } from "@/features/status/PlatformStatusProvider.tsx";
import { buysBlockedByStatus } from "@/features/status/connection-status-core.ts";
import { useComboDraft } from "./combo-draft.ts";
import { useComboQuote } from "./use-combo-quote.ts";
import { useComboTrade } from "./use-combo-trade.ts";

/**
 * Task 072 / CB-002 — the builder's brain, the shape of `useTradeTicket`:
 * the draft legs, the stake, the debounced quote, the readiness of the one
 * action (login / paused / fund / ready / waiting), the funding sheet, and
 * the execution. The component only renders what this returns.
 */
export function useComboBuilder() {
  const { authenticated, user } = usePrivy();
  const legs = useComboDraft();
  const [stake, setStake] = useState("10");
  const [fundingOpen, setFundingOpen] = useState(false);
  const [fundingSkipped, setFundingSkipped] = useState(false);
  const balance = useLiveBalance();
  const { status: platformStatus } = usePlatformStatus();
  const { quote, quoting } = useComboQuote(legs, stake, authenticated && legs.length >= 2);
  const trade = useComboTrade(legs);

  const ok = quote?.ok ? quote : null;
  const funding = ok ? needsFunding("buy", ok.stakeRaw, balance.usdcRaw) : false;
  const readiness = ticketReadiness({
    authenticated,
    quoted: ok !== null && ok.gate.ok && trade.phase.kind === "idle",
    funding: funding && !fundingSkipped,
    paused: buysBlockedByStatus(platformStatus),
  });
  const busy = ["building", "approving", "signing", "confirming"].includes(trade.phase.kind);
  const error =
    trade.phase.kind === "error"
      ? describeTradeError(trade.phase.error)
      : trade.phase.kind === "failed"
        ? revertedTradeError()
        : null;
  const confirm = () => {
    if (readiness === "fund") {
      setFundingOpen(true);
      return;
    }
    if (readiness !== "ready" || !ok) return;
    void trade.execute(ok);
  };
  const login = () => {
    window.dispatchEvent(new Event("mantua:open-login"));
  };

  return {
    authenticated,
    walletAddress: user?.wallet?.address,
    legs,
    stake,
    setStake: (next: string) => {
      setStake(next);
      setFundingSkipped(false);
    },
    quote,
    quoting,
    readiness,
    busy,
    error,
    confirm,
    login,
    trade,
    executed: trade.phase.kind === "done" ? trade.phase : null,
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
