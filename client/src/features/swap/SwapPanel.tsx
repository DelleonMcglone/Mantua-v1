import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useConfirmedAction } from "@/hooks/use-confirmed-action.tsx";
import { getUserFacingTokenSymbols, TOKENS, type TokenSymbol } from "@/lib/tokens.ts";
import { usePortfolio } from "@/features/portfolio/use-portfolio.ts";
import { FEE_TIER_LABELS, type FeeTier } from "@/features/liquidity/fee-tiers.ts";
import {
  HOOK_LABELS,
  hookCompatibilityError,
  recommendedHookForPair,
} from "@/features/liquidity/hook-recommendations.ts";
import type { HookName } from "@/features/liquidity/use-create-pool.ts";
import { BRIDGE_DESTINATIONS, type BridgeDestination } from "@/features/bridge/bridge-chains.ts";
import { useBridge } from "@/features/bridge/use-bridge.ts";
import { BridgeDestinationSelector } from "./BridgeDestinationSelector.tsx";
import { TokenIcon } from "./TokenIcon.tsx";
import { TokenSelector } from "./TokenSelector.tsx";
import { formatTokenAmount, parseTokenAmount } from "./format.ts";
import { useSwapMaxInput, useSwapQuote, useSwap } from "./use-swap.ts";
import { EXPLORER_TX_URL, DEFAULT_SLIPPAGE_BPS } from "./constants.ts";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";

/** Which venue the panel trades against: the pair's recommended hook pool,
 *  the no-hook pool, or the CCTP bridge (move USDC to another network). */
export type SwapVenue = "hook" | "none" | "bridge";

interface Props {
  onClose?: () => void;
  initialTokenIn?: TokenSymbol;
  initialTokenOut?: TokenSymbol;
  /** Pre-select a hook / pre-fill the amount from a chat command. */
  initialHook?: HookName;
  initialAmount?: string;
  /** Pre-select the venue tab ("bridge" for bridge commands). */
  initialVenue?: SwapVenue;
  /** Bridge Kit sdkName of the destination chain, for bridge commands. */
  initialBridgeDestination?: string;
}

function safeParse(symbol: TokenSymbol, input: string): string {
  if (!input || input === ".") return "0";
  try {
    return parseTokenAmount(symbol, input).toString();
  } catch {
    return "0";
  }
}

/**
 * Turn a decoded on-chain revert (e.g. `CircuitBreakerTripped(4, …)`)
 * into a sentence a user can act on. Falls back to the raw decoded
 * string when no specific match is found so we never hide info.
 */
function humanizeRevertReason(decoded: string): string {
  if (/^CircuitBreakerTripped/.test(decoded)) {
    return "Stable Protection hook detected a depeg and tripped its circuit breaker. Try again later or use a different hook.";
  }
  if (/^PoolNotConfigured/.test(decoded)) {
    return "This Dynamic Fee pool hasn't been configured by the hook owner yet — swaps stay disabled until a one-time owner setup (configurePool) runs. Use a different hook for now.";
  }
  if (/^NotWhitelisted/.test(decoded)) {
    return "RWA Gate is a permissioned pool — your address isn't allowlisted in its compliance registry yet, so swaps are blocked. The hook owner must whitelist the account first.";
  }
  if (/^NotEnoughLiquidity/.test(decoded)) {
    return "This pool has no liquidity yet — add liquidity to it before swapping (Add Liquidity → same pair, hook, and fee tier).";
  }
  if (/Stable Protection is only available on the USDC\/EURC pair/.test(decoded)) {
    return "Stable Protection works only on USDC/EURC. Pick that pair or choose a different hook.";
  }
  if (/^Error:/.test(decoded)) return decoded.replace(/^Error:\s*/, "");
  // Generic hook rejection we couldn't decode to a named error (e.g. the
  // ALO async-limit-order hook, which doesn't fill a plain market swap).
  // Surface a readable message instead of the raw WrappedError(0x…) hex.
  if (/^WrappedError\(/.test(decoded)) {
    return "The hook rejected this swap. The pool may need a one-time owner setup, or this hook doesn't support a direct market swap for this pair — try a different hook.";
  }
  return decoded;
}

function ctaLabel(status: ReturnType<typeof useSwap>["state"]["status"]): string {
  switch (status) {
    case "quoting":
      return "Building swap…";
    case "approving":
      return "Approving in wallet…";
    case "signing":
      return "Sign swap in wallet…";
    case "pending":
      return "Confirming on-chain…";
    case "success":
      return "Swap complete";
    case "error":
      return "Try again";
    default:
      return "Sign & swap";
  }
}

function bridgeCtaLabel(
  status: ReturnType<typeof useBridge>["state"]["status"],
  amountEntered: boolean,
  overBalance: boolean,
): string {
  switch (status) {
    case "preparing":
      return "Preparing…";
    case "approving":
      return "Approve in wallet…";
    case "burning":
      return "Starting bridge…";
    case "attesting":
      return "Awaiting attestation…";
    case "minting":
      return "Minting on destination…";
    case "success":
      return "Bridge complete";
    default:
      return !amountEntered ? "Enter amount" : overBalance ? "Insufficient USDC" : "Review bridge";
  }
}

/**
 * Swap panel — talks to `/api/v4/quote` (V4Quoter) and
 * `/api/v4/swap/calldata` and runs the approve-if-needed → swap
 * sequence from the user's wallet on Base Mainnet.
 *
 * Venues: every pair trades against its recommended-hook pool or the
 * no-hook pool, and the panel also hosts the CCTP bridge as a third
 * venue — same Sell/Buy layout, but the Buy side becomes "USDC on
 * <chain>" (1:1 mint on the destination) and the CTA runs the Bridge
 * Kit flow from the user's wallet. The switcher sits above the CTA:
 *   USDC/EURC          → Stable Protection | No Hook | Bridge
 *   USDC|EURC / cbBTC  → Dynamic Fee       | No Hook | Bridge
 */
export function SwapPanel({
  onClose,
  initialTokenIn,
  initialTokenOut,
  initialAmount,
  initialVenue,
  initialBridgeDestination,
}: Props) {
  const seedIn: TokenSymbol = initialVenue === "bridge" ? "USDC" : (initialTokenIn ?? "USDC");
  const seedOut: TokenSymbol = initialTokenOut ?? "EURC";
  const [tokenIn, setTokenIn] = useState<TokenSymbol>(seedIn);
  const [tokenOut, setTokenOut] = useState<TokenSymbol>(seedOut === seedIn ? "EURC" : seedOut);
  const [amount, setAmount] = useState(initialAmount ?? "");
  const chainId = BASE_CHAIN_ID;
  const pairHook = useMemo(
    () => recommendedHookForPair(tokenIn, tokenOut, chainId),
    [tokenIn, tokenOut, chainId],
  );
  const [venue, setVenue] = useState<SwapVenue>(initialVenue ?? "hook");
  const [destination, setDestination] = useState<BridgeDestination>(
    () =>
      BRIDGE_DESTINATIONS.find((d) => d.sdkName === initialBridgeDestination) ??
      BRIDGE_DESTINATIONS[0],
  );
  const hook: HookName | "none" = useMemo(
    () => (pairHook && venue === "hook" ? pairHook : "none"),
    [pairHook, venue],
  );
  // Fee tier follows the chosen hook: Stable Protection → 0.01%; Dynamic
  // Fee → 0.05% (funded, correct-price pools); No Hook → 0.30%.
  const fee: FeeTier = useMemo(
    () => (hook === "stable-protection" ? 100 : hook === "dynamic-fee" ? 500 : 3000),
    [hook],
  );
  const [slippageBps] = useState(DEFAULT_SLIPPAGE_BPS);

  const confirm = useConfirmedAction();
  const swap = useSwap();
  const bridge = useBridge();
  const portfolio = usePortfolio();

  // Pairs without a recommended hook offer only No Hook | Bridge; normalize
  // the default "hook" selection onto "none" so the switcher highlights.
  const activeVenue: SwapVenue = !pairHook && venue === "hook" ? "none" : venue;
  const isBridge = activeVenue === "bridge";

  // Keep the Sell/Buy pickers scoped to valid, distinct tokens for the
  // active chain. Keeps the user's picks when they're still valid.
  useEffect(() => {
    const valid = getUserFacingTokenSymbols(chainId);
    if (valid.length === 0) return;
    const nextIn = valid.includes(tokenIn) ? tokenIn : valid[0];
    const nextOut =
      valid.includes(tokenOut) && tokenOut !== nextIn
        ? tokenOut
        : (valid.find((s) => s !== nextIn) ?? nextIn);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (nextIn !== tokenIn) setTokenIn(nextIn);
    if (nextOut !== tokenOut) setTokenOut(nextOut);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Rescope only when the chain changes — not on every token edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId]);

  const balanceIn = useMemo(() => {
    const b = portfolio.balances.find((x) => x.symbol === tokenIn);
    return b ? BigInt(b.balanceRaw) : 0n;
  }, [portfolio.balances, tokenIn]);
  const balanceInDisplay = useMemo(
    () => formatTokenAmount(tokenIn, balanceIn),
    [tokenIn, balanceIn],
  );

  // Probe pool depth on the active key so the chips can't overshoot.
  // Capped at 95% of the discovered max so we leave a tiny safety
  // margin against price-impact drift between the search and the
  // actual swap call.
  const poolMax = useSwapMaxInput({
    tokenIn,
    tokenOut,
    fee,
    hook: hook === "none" ? null : hook,
    balanceRaw: balanceIn,
    enabled: balanceIn > 0n && !isBridge,
  });
  const cappedMax = useMemo<bigint | null>(() => {
    if (poolMax.maxInputRaw === null) return null;
    return (poolMax.maxInputRaw * 95n) / 100n;
  }, [poolMax.maxInputRaw]);

  function applyPercent(pct: number) {
    if (balanceIn === 0n) return;
    let raw = (balanceIn * BigInt(pct)) / 100n;
    if (TOKENS[tokenIn].native && pct === 100) {
      const buffer = 200_000_000_000_000n;
      raw = raw > buffer ? raw - buffer : 0n;
    }
    // Clamp to the largest amount the pool can absorb (swap venues only —
    // the bridge moves USDC 1:1, no pool involved). Skip the clamp when
    // `cappedMax` is null (loading / lookup failed) OR zero (no pool
    // exists for this pair+fee+hook combo).
    if (!isBridge && cappedMax !== null && cappedMax > 0n && raw > cappedMax) raw = cappedMax;
    setAmount(formatTokenAmount(tokenIn, raw));
  }

  const hookName: HookName | null = hook === "none" ? null : hook;
  const hookIncompatible = hookCompatibilityError(tokenIn, tokenOut, hookName, chainId);

  const amountInRaw = safeParse(tokenIn, amount);
  const quote = useSwapQuote({
    tokenIn,
    tokenOut,
    fee,
    hook: hookName,
    amountInRaw,
    // Skip the quote round-trip when we already know the hook will
    // reject the pair on-chain — surfaces the inline reason instead —
    // and in bridge mode, where no pool quote applies.
    enabled: amountInRaw !== "0" && hookIncompatible === null && !isBridge,
  });

  const expectedOut = quote.data ? formatTokenAmount(tokenOut, quote.data.amountOut) : "";
  // A quote that returns 0 — OR a dust amount that rounds to "0.000000" at
  // display precision — means the pool has no usable liquidity / is mispriced
  // at this size (e.g. a thin Dynamic Fee USDC/cbBTC pool can return a few
  // wei). Flag it so the user gets a clear message + a blocked swap, instead
  // of a silent "0.000000" with the swap button still enabled.
  const noLiquidity =
    quote.data !== null && (BigInt(quote.data.amountOut) === 0n || parseFloat(expectedOut) === 0);

  function selectTokenIn(sym: TokenSymbol) {
    if (sym === tokenOut) setTokenOut(tokenIn);
    setTokenIn(sym);
  }
  function selectTokenOut(sym: TokenSymbol) {
    if (sym === tokenIn) setTokenIn(tokenOut);
    setTokenOut(sym);
  }

  function flip() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
  }

  // Bridging is USDC-only from Base: entering the Bridge venue pins the
  // Sell token to USDC (restoring a distinct Buy token if needed). The
  // Buy side becomes the destination-chain picker.
  function selectVenue(v: SwapVenue) {
    if (v === "bridge" && tokenIn !== "USDC") {
      if (tokenOut === "USDC") setTokenOut(tokenIn);
      setTokenIn("USDC");
    }
    setVenue(v);
  }

  async function onSwap() {
    if (!quote.data) return;
    const ok = await confirm({
      title: `Swap ${amount} ${tokenIn} → ${expectedOut} ${tokenOut}`,
      description: `${FEE_TIER_LABELS[fee]} · ${hook === "none" ? "No Hook" : HOOK_LABELS[hook]} · ${(slippageBps / 100).toFixed(2)}% slippage`,
      confirmLabel: "Sign & swap",
    });
    if (!ok) return;
    await swap.execute({
      tokenIn,
      tokenOut,
      fee,
      hook: hook === "none" ? null : hook,
      amountInRaw,
      slippageBps,
    });
  }

  const amountEntered = amountInRaw !== "0" && parseFloat(amount) > 0;

  // ── Bridge-mode state ──────────────────────────────────────────────────
  const bridgeStatus = bridge.state.status;
  const bridgeBusy =
    bridgeStatus === "preparing" ||
    bridgeStatus === "approving" ||
    bridgeStatus === "burning" ||
    bridgeStatus === "attesting" ||
    bridgeStatus === "minting";
  const bridgeOverBalance = BigInt(amountInRaw) > balanceIn;
  const canBridge =
    Boolean(portfolio.walletAddress) && !bridgeBusy && amountEntered && !bridgeOverBalance;

  async function onBridge() {
    if (!canBridge) return;
    const ok = await confirm({
      title: `Bridge ${amount} USDC → ${destination.label}`,
      description: `Via Circle CCTP. You sign approve + burn; Circle mints USDC to your address on ${destination.label}.`,
      confirmLabel: "Bridge",
    });
    if (!ok) return;
    await bridge.execute({ amount, destination });
  }

  const venueOptions: readonly SwapVenue[] = pairHook
    ? ["hook", "none", "bridge"]
    : ["none", "bridge"];
  const venueLabel = (v: SwapVenue): string =>
    v === "hook" && pairHook ? HOOK_LABELS[pairHook] : v === "bridge" ? "Bridge" : "No Hook";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PanelHeader />
      <PanelSubHeader title="Swap" {...(onClose ? { onClose } : {})} />

      <div className="flex-1 overflow-auto px-5 pt-2 pb-5">
        {/* Sell card */}
        <div className="bg-bg-elev border border-border-soft rounded-md px-4 py-3.5">
          <div className="flex items-center justify-between text-[13px]">
            <span>{isBridge ? "Bridge" : "Sell"}</span>
            <span className="text-text-dim">
              Balance: {balanceInDisplay} {tokenIn}
            </span>
          </div>
          {/* Input diagnostics (no-pool / hook rejection) describe the
              NEXT swap, so suppress them once a swap has completed — otherwise
              a post-swap max-input probe that trips the SP circuit breaker
              shows a "rejected" banner right next to the success view. They
              return when the user starts a fresh swap ("Make another swap"). */}
          {!isBridge &&
            swap.state.status !== "success" &&
            amountEntered &&
            cappedMax !== null &&
            cappedMax === 0n && (
              <div className="text-[11px] text-amber mt-1.5">
                {poolMax.reason
                  ? `Swap rejected by hook: ${humanizeRevertReason(poolMax.reason)}`
                  : `No pool found for ${tokenIn}/${tokenOut} at this fee tier and hook. Try a different fee tier, hook, or pair.`}
              </div>
            )}
          <div className="flex gap-2 mt-2.5">
            {(
              [
                { label: "25%", pct: 25 },
                { label: "50%", pct: 50 },
                { label: "75%", pct: 75 },
                { label: "Max", pct: 100 },
              ] as const
            ).map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  applyPercent(p.pct);
                }}
                disabled={balanceIn === 0n}
                className="flex-1 py-[7px] border border-border bg-transparent text-text-dim rounded-xs text-[12px] cursor-pointer font-medium hover:text-text hover:border-text-mute transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between mt-3.5">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
              placeholder="0.00"
              className={`flex-1 min-w-0 bg-transparent border-none outline-none p-0 font-mono text-[38px] font-light tracking-[-0.03em] ${
                amountEntered ? "text-text" : "text-text-mute"
              }`}
            />
            {isBridge ? (
              // Bridging is USDC-only — fixed pill instead of the picker.
              <span className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-panel-solid border border-border text-[14px] font-medium">
                <TokenIcon symbol="USDC" size={20} />
                USDC
              </span>
            ) : (
              <TokenSelector value={tokenIn} onChange={selectTokenIn} />
            )}
          </div>
        </div>

        {!isBridge && (
          <div className="flex justify-center -my-2.5 relative z-10">
            <button
              type="button"
              onClick={flip}
              aria-label="Flip tokens"
              className="w-[34px] h-[34px] rounded-full bg-bg-elev border border-border flex items-center justify-center cursor-pointer text-green hover:border-green/60 transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 20V4M7 4l-4 4M7 4l4 4" />
                <path d="M17 4v16M17 20l-4-4M17 20l4-4" />
              </svg>
            </button>
          </div>
        )}

        {/* Buy card — in bridge mode the Buy side is the same USDC arriving
            on the destination chain (1:1 mint, forwarding fee deducted). */}
        <div className="bg-bg-elev border border-border-soft rounded-md px-4 py-3.5 mt-3">
          <div className="flex items-center justify-between text-[13px]">
            <span>{isBridge ? `Bridge to · ${destination.label}` : "Buy"}</span>
            <span className="text-text-dim">expected</span>
          </div>
          <div className="flex items-center justify-between mt-3.5">
            <input
              value={isBridge ? (amountEntered ? amount : "") : expectedOut}
              readOnly
              placeholder="0.00"
              className="flex-1 min-w-0 bg-transparent border-none outline-none p-0 font-mono text-[38px] font-light tracking-[-0.03em] text-text-mute"
            />
            {isBridge ? (
              <BridgeDestinationSelector
                value={destination}
                onChange={setDestination}
                disabled={bridgeBusy}
              />
            ) : (
              <TokenSelector value={tokenOut} onChange={selectTokenOut} />
            )}
          </div>
        </div>

        {/* Venue switcher — above the CTA: hook pool | no-hook pool | bridge. */}
        <div className="mt-5">
          <p className="text-[10px] text-text-mute tracking-[0.08em] mb-1.5 font-semibold">VENUE</p>
          <div className="flex gap-1 bg-bg-elev p-0.5 rounded-md border border-border-soft">
            {venueOptions.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  selectVenue(v);
                }}
                className={`flex-1 py-2 text-[12px] rounded-xs font-medium ${
                  activeVenue === v ? "bg-chip text-text" : "bg-transparent text-text-dim"
                }`}
              >
                {venueLabel(v)}
              </button>
            ))}
          </div>
        </div>

        {isBridge ? (
          <p className="text-[11px] text-text-mute mt-3">
            Via Circle CCTP + Forwarding Service — you sign approve and burn; Circle mints USDC to
            your address on {destination.label}. No destination gas required.
          </p>
        ) : (
          <div className="mt-3 flex items-center justify-between text-[13px]">
            <span className="text-text-dim">Fee tier</span>
            <span className="font-mono text-text">{FEE_TIER_LABELS[fee]}</span>
          </div>
        )}

        {!isBridge && hookIncompatible && (
          <p className="text-xs text-amber text-center mt-3">{hookIncompatible}</p>
        )}
        {!isBridge && !hookIncompatible && quote.loading && (
          <p className="text-xs text-text-dim text-center mt-3">Fetching quote…</p>
        )}
        {/* Humanize the quote failure to a specific, actionable reason. Skip it
            when the under-Sell banner already shows the same diagnosis (the
            max-input probe trips at cappedMax === 0). */}
        {!isBridge && !hookIncompatible && quote.error && !(amountEntered && cappedMax === 0n) && (
          <p className="text-xs text-red text-center mt-3">
            {humanizeRevertReason(quote.error.message)}
          </p>
        )}
        {!isBridge && !hookIncompatible && !quote.error && noLiquidity && (
          <p className="text-xs text-amber text-center mt-3">
            Insufficient liquidity — this pool returned almost nothing for that amount. Try the No
            Hook option, a different fee tier, or another pair.
          </p>
        )}

        {isBridge ? (
          <Button
            variant="primary"
            size="lg"
            disabled={!canBridge || bridgeStatus === "success"}
            onClick={() => {
              void onBridge();
            }}
            className="w-full mt-5"
          >
            {!portfolio.walletAddress
              ? "Connect a wallet to bridge"
              : bridgeCtaLabel(bridgeStatus, amountEntered, bridgeOverBalance)}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            disabled={
              hookIncompatible !== null ||
              !quote.data ||
              noLiquidity ||
              !amountEntered ||
              swap.state.status === "quoting" ||
              swap.state.status === "approving" ||
              swap.state.status === "signing" ||
              swap.state.status === "pending" ||
              swap.state.status === "success"
            }
            onClick={() => {
              void onSwap();
            }}
            className="w-full mt-5"
          >
            {hookIncompatible
              ? "Hook unavailable for this pair"
              : !amountEntered
                ? "Enter amount"
                : noLiquidity
                  ? "Insufficient liquidity"
                  : ctaLabel(swap.state.status)}
          </Button>
        )}

        {/* Bridge progress / results */}
        {isBridge &&
          bridge.state.message &&
          bridgeStatus !== "success" &&
          bridgeStatus !== "error" && (
            <p className="text-xs text-text-dim text-center mt-2">{bridge.state.message}</p>
          )}
        {isBridge && bridgeStatus === "error" && bridge.state.error && (
          <p className="text-xs text-red text-center mt-3">{bridge.state.error}</p>
        )}
        {isBridge && bridge.state.burnTx && (
          <a
            href={`${EXPLORER_TX_URL}${bridge.state.burnTx}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:text-accent-2 inline-flex items-center gap-1 justify-center mt-3 w-full font-mono"
          >
            Burn transaction <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {isBridge && bridge.state.mintTx && (
          <a
            href={destination.explorerTxUrl(bridge.state.mintTx)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:text-accent-2 inline-flex items-center gap-1 justify-center mt-2 w-full font-mono"
          >
            Mint on {destination.label} <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {isBridge && bridgeStatus === "success" && (
          <button
            type="button"
            onClick={() => {
              bridge.reset();
              setAmount("");
            }}
            className="block mx-auto mt-3 px-3 py-1.5 rounded-xs border border-border bg-transparent text-text-dim text-[12px] cursor-pointer hover:text-text hover:border-text-mute transition-colors"
          >
            Bridge again
          </button>
        )}

        {/* Swap progress / results */}
        {!isBridge &&
          swap.state.message &&
          swap.state.status !== "idle" &&
          swap.state.status !== "error" && (
            <p className="text-xs text-text-mute text-center mt-2">{swap.state.message}</p>
          )}
        {!isBridge && swap.state.approvalTx && (
          <a
            href={`${EXPLORER_TX_URL}${swap.state.approvalTx}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-text-dim hover:text-accent inline-flex items-center gap-1 justify-center mt-3 w-full"
          >
            Approval tx <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {!isBridge && swap.state.txHash && (
          <a
            href={`${EXPLORER_TX_URL}${swap.state.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:text-accent-2 inline-flex items-center gap-1 justify-center mt-3 w-full"
          >
            View on explorer <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {!isBridge && swap.state.status === "success" && (
          <button
            type="button"
            onClick={() => {
              swap.reset();
              setAmount("");
            }}
            className="block mx-auto mt-3 px-3 py-1.5 rounded-xs border border-border bg-transparent text-text-dim text-[12px] cursor-pointer hover:text-text hover:border-text-mute transition-colors"
          >
            Make another swap
          </button>
        )}
        {!isBridge && swap.state.status === "error" && swap.state.error && (
          <p className="text-xs text-red text-center mt-3">{swap.state.error.message}</p>
        )}
      </div>
    </div>
  );
}
