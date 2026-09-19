import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import { useChainWalletClient } from "@/lib/privy/wallet-client.ts";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";
import type { FeeQuoteWire } from "./market-trade-core.ts";
import { usePendingTrades } from "./PendingTradesProvider.tsx";
import { classifyTradeError, type TradeErrorKind } from "./trade-status-core.ts";
import { approveIfNeeded, awaitTradeReceipt, sendTrade } from "./wallet-execution.ts";

/** How long the ticket itself waits for the receipt before handing the
 *  trade to the pending register (which keeps asking the server). A Base
 *  block is ~2 s; a minute of silence is an RPC problem, not a slow chain. */
export { RECEIPT_WAIT_MS } from "./wallet-execution.ts";

/** A hash the chain never mined (R-004 `dropped`) — nothing was traded. */
const DROPPED_MESSAGE =
  "This trade was never placed — it was dropped before it could go through. Nothing was traded.";

/**
 * The pre-trade quote (`POST /api/markets/trade/quote`, task 050): what the
 * ticket renders while the user is still choosing an amount. Carries no
 * executable calldata, and asking for it consumes none of the user's daily
 * spending cap — the cap is only checked, never recorded, on this path.
 */
export interface TradeQuote {
  marketAddress: `0x${string}`;
  marketId: `0x${string}`;
  yesToken: `0x${string}`;
  quote: {
    amountIn: string;
    amountOut: string;
    /** Quote − slippage tolerance (display; the calldata's price bound
     *  enforces the same tolerance on-chain). */
    amountOutMinimum: string;
    effectivePriceBps: number | null;
  };
  /** D-105 fee from the hook's `quoteFee` — the execution's own number (H-012). */
  fee: FeeQuoteWire;
}

/**
 * The executable trade (`POST /api/markets/trade/calldata`): requested once,
 * when the user commits. Issuing it records the buy's spend intent against
 * the daily cap server-side (C-019), so it is fetched at execute time, not
 * on every keystroke.
 */
export interface TradeCalldata extends TradeQuote {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  approvalTarget: `0x${string}` | null;
  inputToken: `0x${string}`;
  /** On-chain price bound encoded in `data` — the server-built calldata
   *  carries the slippage protection; the client just signs it. */
  sqrtPriceLimitX96: string;
}

/**
 * Phase 7 / R-004 — every state a trade can be in, and none of them
 * ambiguous. Before the chain: idle → quoting → quoted → building →
 * approving → signing. With a hash: confirming (we are waiting on the
 * receipt), pending (the receipt wait timed out; the pending register is
 * still asking the server — this is NOT a failure), done (mined, success),
 * failed (mined, reverted — nothing traded). `error` is reserved for
 * things that never reached the chain, with a kind so the copy can say
 * "you declined" rather than "failed".
 */
export type TradePhase =
  | { kind: "idle" }
  /** Re-quoting; `previous` keeps the last numbers on screen (R-003: no
   *  blank ticket on every keystroke). */
  | { kind: "quoting"; previous: TradeQuote | null }
  | { kind: "quoted"; quote: TradeQuote }
  /** Calldata requested — the cap check + intent record happen here. */
  | { kind: "building"; quote: TradeQuote }
  | { kind: "approving" | "signing"; calldata: TradeCalldata }
  | { kind: "confirming"; txHash: `0x${string}`; calldata: TradeCalldata }
  | { kind: "pending"; txHash: `0x${string}`; calldata: TradeCalldata }
  | { kind: "done"; txHash: `0x${string}`; calldata: TradeCalldata; recorded: boolean }
  | { kind: "failed"; txHash: `0x${string}`; calldata: TradeCalldata }
  /** `error` is the thrown value itself so the ticket can map its code to
   *  owner-readable copy (T-012); `errorKind` is the coarse class (R-004). */
  | { kind: "error"; message: string; errorKind: TradeErrorKind; error: unknown };

interface Args {
  eventId: string;
  outcomeIndex: 0 | 1;
  direction: "buy" | "sell";
  /** Human units: USDC for buys, YES tokens for sells. */
  amount: string;
  enabled: boolean;
}

/**
 * Quote + execute one outcome-token trade. The server builds calldata (it
 * holds no keys); the user's wallet signs the approval and the swap. Used
 * by the league page's trade sidebar.
 *
 * Two server calls, deliberately: the debounced re-quote hits the quote
 * route (no calldata, no ledger ink), and `execute` fetches the calldata
 * fresh — that single request is where the daily cap is checked and the
 * spend intent recorded (task 050 / C-019).
 *
 * The moment the wallet returns a hash the trade enters the pending
 * register (persisted per wallet), and leaves it only on a verified
 * terminal state — so a reload or a dropped RPC mid-confirmation never
 * loses the trade (Phase 7 / R-004).
 */
export function useMarketTrade({ eventId, outcomeIndex, direction, amount, enabled }: Args) {
  const getWallet = useChainWalletClient();
  const chainId = BASE_CHAIN_ID;
  const [phase, setPhase] = useState<TradePhase>({ kind: "idle" });
  const register = usePendingTrades();

  // Debounced re-quote on any input change — quote only, never calldata.
  useEffect(() => {
    if (!enabled) return;
    const raw = Math.round(Number(amount) * 1e6);
    const timer = setTimeout(() => {
      if (!Number.isFinite(raw) || raw <= 0) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase((prev) => ({
        kind: "quoting",
        previous:
          prev.kind === "quoted" ? prev.quote : prev.kind === "quoting" ? prev.previous : null,
      }));
      api
        .post<TradeQuote>("/api/markets/trade/quote", {
          chainId,
          providerEventId: eventId,
          outcomeIndex,
          direction,
          amountRaw: String(raw),
        })
        .then((quote) => {
          setPhase({ kind: "quoted", quote });
        })
        .catch((err: unknown) => {
          const e = classifyTradeError(err, "Quote failed");
          setPhase({ kind: "error", message: e.message, errorKind: e.kind, error: err });
        });
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [enabled, eventId, outcomeIndex, direction, amount, chainId]);

  // While the ticket shows `pending`, the register's resume loop is the
  // one asking the server; when it settles the hash, mirror the outcome.
  useEffect(() => {
    if (phase.kind !== "pending") return;
    const hit = register.settled.find(
      (s) => s.trade.txHash.toLowerCase() === phase.txHash.toLowerCase(),
    );
    if (!hit) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors an external settlement into the ticket's phase.
    setPhase(
      hit.outcome === "confirmed"
        ? { kind: "done", txHash: phase.txHash, calldata: phase.calldata, recorded: true }
        : hit.outcome === "failed"
          ? { kind: "failed", txHash: phase.txHash, calldata: phase.calldata }
          : {
              kind: "error",
              errorKind: "unknown",
              message: DROPPED_MESSAGE,
              error: new Error(DROPPED_MESSAGE),
            },
    );
    register.dismiss(phase.txHash);
  }, [phase, register]);

  const execute = async () => {
    if (phase.kind !== "quoted") return;
    const { quote } = phase;
    try {
      const wallet = await getWallet();
      if (!wallet) throw new Error("No wallet connected");
      const owner = wallet.account.address;

      // The commit: one calldata request, cap-checked and recorded
      // server-side. Its own quote (fresher than the ticket's) is what the
      // wallet signs against and what the fill reports. The amount is the
      // one the ticket quoted (quote.amountIn), not a re-read of the input.
      setPhase({ kind: "building", quote });
      const calldata = await api.post<TradeCalldata>("/api/markets/trade/calldata", {
        chainId,
        providerEventId: eventId,
        outcomeIndex,
        direction,
        amountRaw: quote.quote.amountIn,
      });

      // Bounded approval, then the signed send (task 072: shared with the
      // combo builder — `wallet-execution.ts`).
      await approveIfNeeded(wallet, calldata, chainId, () => {
        setPhase({ kind: "approving", calldata });
      });
      setPhase({ kind: "signing", calldata });
      const txHash = await sendTrade(wallet, calldata);

      // A hash exists: from here on the trade is on the chain's clock, not
      // ours. Register it before waiting so nothing can lose it.
      const tokensRaw = direction === "buy" ? calldata.quote.amountOut : calldata.quote.amountIn;
      const usdcRaw = direction === "buy" ? calldata.quote.amountIn : calldata.quote.amountOut;
      register.add({
        txHash,
        chainId,
        wallet: owner,
        marketId: calldata.marketId,
        providerEventId: eventId,
        direction,
        tokensRaw,
        usdcRaw,
        submittedAt: Date.now(),
      });
      setPhase({ kind: "confirming", txHash, calldata });

      const receipt = await awaitTradeReceipt(chainId, txHash);
      if (receipt === "late") {
        // Not a failure: the receipt is late or the RPC is flaky. The
        // register keeps asking the server; the ticket says "pending".
        setPhase({ kind: "pending", txHash, calldata });
        return;
      }
      if (receipt !== "success") {
        register.remove(txHash);
        setPhase({ kind: "failed", txHash, calldata });
        return;
      }

      // Record the fill for entry-price / P&L accounting. The server
      // verifies the receipt before believing it. The daily cap was already
      // recorded at calldata issuance; the fill never re-records. If the
      // report fails the trade stays registered and the resume loop
      // re-reports it — `recorded` tells the ticket which happened.
      let recorded = false;
      try {
        await api.post("/api/markets/fills", {
          chainId,
          txHash,
          marketId: calldata.marketId,
          direction,
          tokensRaw,
          usdcRaw,
        });
        recorded = true;
        register.remove(txHash);
      } catch {
        recorded = false;
      }
      setPhase({ kind: "done", txHash, calldata, recorded });
      window.dispatchEvent(new Event("mantua:refresh-portfolio"));
    } catch (err) {
      const e = classifyTradeError(err, "Trade failed");
      setPhase({ kind: "error", message: e.message, errorKind: e.kind, error: err });
    }
  };

  return { phase, execute };
}
