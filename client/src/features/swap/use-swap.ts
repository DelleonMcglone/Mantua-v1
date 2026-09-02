/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { hardenProvider } from "@/lib/privy/wallet-client.ts";
/**
 * Base Mainnet swap path — swaps quote and execute on-chain: this hook
 * talks to our `/api/v4/quote` and `/api/v4/swap/calldata` endpoints
 * (which call `V4Quoter` and build v4 swap calldata respectively) and
 * runs the approve-if-needed → swap sequence in the user's wallet.
 */
import { useEffect, useMemo, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { createPublicClient, createWalletClient, custom, parseAbi } from "viem";
import { useCurrentChainId } from "@/lib/chain-context.tsx";
import { getChainInfo, getRpcTransport } from "@/lib/chains.ts";
import { ApiError, api } from "@/lib/api.ts";
import { getToken, type TokenSymbol } from "@/lib/tokens.ts";
import { type FeeTier } from "@/features/liquidity/fee-tiers.ts";
import type { HookName } from "@/features/liquidity/use-create-pool.ts";

const MAX_UINT = (1n << 256n) - 1n;
const FRESH_APPROVAL_THRESHOLD = 1n << 255n;

const erc20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

interface QuoteRes {
  amountOut: string;
  gasEstimate: string;
  poolKey: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  zeroForOne: boolean;
}

interface CalldataRes {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  approvalTarget: `0x${string}` | null;
  quote: QuoteRes & { amountIn: string; amountOutMinimum: string };
}

export interface SwapArgs {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  fee: FeeTier;
  hook: HookName | null;
  amountInRaw: string;
  slippageBps: number;
}

interface State {
  status: "idle" | "quoting" | "approving" | "signing" | "pending" | "success" | "error";
  amountOut?: string;
  approvalTx?: `0x${string}`;
  txHash?: `0x${string}`;
  error?: ApiError | Error;
  message?: string;
}

interface QuoteState {
  data: QuoteRes | null;
  loading: boolean;
  error: ApiError | Error | null;
}

interface MaxInputState {
  /** Raw base-units cap. `null` while loading or if not yet fetched
   *  for the current pool. */
  maxInputRaw: bigint | null;
  loading: boolean;
  /** Human-readable reason when the cap is 0 — surfaces hook-side
   *  reverts (e.g. `CircuitBreakerTripped`) so the UI can show the
   *  actual cause instead of a misleading "no pool found". */
  reason: string | null;
}

/**
 * Look up the largest input amount the pool can absorb without the
 * V4Quoter reverting, bounded by the user's `balanceRaw`. The percent
 * chips clamp to `min(balance × pct, max × 0.95)` so a click can't
 * overshoot pool depth.
 *
 * Refetches on pair / fee / hook / balance change. Each fetch fires
 * one POST to `/api/v4/swap/max-input` which itself runs ~25
 * `eth_call`s — so don't poll on a tight interval.
 */
export function useSwapMaxInput(args: {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  fee: FeeTier;
  hook: HookName | null;
  balanceRaw: bigint;
  enabled: boolean;
}): MaxInputState {
  const chainId = useCurrentChainId();
  const [state, setState] = useState<MaxInputState>({
    maxInputRaw: null,
    loading: false,
    reason: null,
  });

  useEffect(() => {
    if (!args.enabled || args.balanceRaw === 0n || args.tokenIn === args.tokenOut) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronous reset when the effect's inputs are disabled.
      setState({ maxInputRaw: null, loading: false, reason: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, reason: null }));
    api
      .post<{ maxInputRaw: string; reason: string | null }>("/api/v4/swap/max-input", {
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        fee: args.fee,
        hook: args.hook,
        upperBoundRaw: args.balanceRaw.toString(),
        chainId,
      })
      .then((data) => {
        if (cancelled) return;
        setState({
          maxInputRaw: BigInt(data.maxInputRaw),
          loading: false,
          reason: data.reason ?? null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // On failure, return null so the caller falls back to the
        // raw wallet balance — the existing quote-failure path will
        // surface a clear error then.
        setState({ maxInputRaw: null, loading: false, reason: null });
      });
    return () => {
      cancelled = true;
    };
  }, [args.tokenIn, args.tokenOut, args.fee, args.hook, args.balanceRaw, args.enabled, chainId]);

  return state;
}

export function useSwapQuote(args: {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  fee: FeeTier;
  hook: HookName | null;
  amountInRaw: string;
  enabled: boolean;
}): QuoteState {
  const chainId = useCurrentChainId();
  const [state, setState] = useState<QuoteState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!args.enabled || args.amountInRaw === "0" || args.tokenIn === args.tokenOut) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronous reset when the effect's inputs are disabled.
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .post<QuoteRes>("/api/v4/quote", {
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        fee: args.fee,
        hook: args.hook,
        amountInRaw: args.amountInRaw,
        chainId,
      })
      .then((data) => {
        if (cancelled) return;
        setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error("Quote failed");
        setState({ data: null, loading: false, error: e });
      });
    return () => {
      cancelled = true;
    };
  }, [args.tokenIn, args.tokenOut, args.fee, args.hook, args.amountInRaw, args.enabled, chainId]);

  return state;
}

export function useSwap() {
  const { wallets } = useWallets();
  const chainId = useCurrentChainId();
  const [state, setState] = useState<State>({ status: "idle" });

  // Memoize the public client by chain so we don't re-create it every
  // render — viem clients are cheap but the RPC connection isn't free.
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: getChainInfo(chainId).viemChain,
        transport: getRpcTransport(chainId),
      }),
    [chainId],
  );

  async function execute(args: SwapArgs): Promise<`0x${string}` | null> {
    try {
      const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime defensive
      if (!wallet) throw new Error("No wallet connected");
      const viemChain = getChainInfo(chainId).viemChain;
      if (wallet.chainId !== `eip155:${String(chainId)}`) {
        await wallet.switchChain(chainId);
      }
      const owner = wallet.address as `0x${string}`;
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: owner,
        chain: viemChain,
        transport: custom(hardenProvider(provider, chainId)),
      }) as any;

      setState({ status: "quoting", message: "Building swap…" });
      const calldata = await api.post<CalldataRes>("/api/v4/swap/calldata", {
        ...args,
        chainId,
      });

      setState({
        status: "quoting",
        amountOut: calldata.quote.amountOut,
        message: "Building swap…",
      });

      // Approve input ERC-20 if needed (skip for native ETH input).
      const tokenIn = getToken(args.tokenIn, chainId);
      if (calldata.approvalTarget && !tokenIn.native) {
        const tokenAddr = tokenIn.address;
        const allowance = await publicClient.readContract({
          address: tokenAddr,
          abi: erc20,
          functionName: "allowance",
          args: [owner, calldata.approvalTarget],
        });
        if (allowance < FRESH_APPROVAL_THRESHOLD) {
          setState({
            status: "approving",
            amountOut: calldata.quote.amountOut,
            message: `Approve ${args.tokenIn} in wallet…`,
          });
          const approvalTx: `0x${string}` = await walletClient.writeContract({
            address: tokenAddr,
            abi: erc20,
            functionName: "approve",
            args: [calldata.approvalTarget, MAX_UINT],
            account: owner,
            chain: viemChain,
          });
          await publicClient.waitForTransactionReceipt({ hash: approvalTx });
          setState({
            status: "approving",
            approvalTx,
            amountOut: calldata.quote.amountOut,
            message: "Approval confirmed",
          });
        }
      }

      setState({
        status: "signing",
        amountOut: calldata.quote.amountOut,
        message: "Sign swap in wallet…",
      });
      const txHash: `0x${string}` = await walletClient.sendTransaction({
        account: owner,
        chain: viemChain,
        to: calldata.to,
        data: calldata.data,
        value: BigInt(calldata.value),
      });
      setState({
        status: "pending",
        txHash,
        amountOut: calldata.quote.amountOut,
        message: "Confirming on-chain…",
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      setState({
        status: receipt.status === "success" ? "success" : "error",
        txHash,
        amountOut: calldata.quote.amountOut,
        ...(receipt.status === "success" ? {} : { error: new Error("Transaction reverted") }),
      });
      return txHash;
    } catch (err) {
      const e = err instanceof Error ? err : new Error("Swap failed");
      setState({ status: "error", error: e });
      return null;
    }
  }

  return {
    state,
    execute,
    reset: () => {
      setState({ status: "idle" });
    },
  };
}
