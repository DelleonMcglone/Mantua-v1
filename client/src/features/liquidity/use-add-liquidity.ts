import { useState } from "react";
import { hardenProvider } from "@/lib/privy/wallet-client.ts";
import { useWallets } from "@privy-io/react-auth";
import { createPublicClient, createWalletClient, custom } from "viem";
import { BASE_CHAIN_ID, CHAIN_INFO, getRpcTransport } from "@/lib/chains.ts";
import { ApiError, api } from "@/lib/api.ts";
import { getToken, type TokenSymbol } from "@/lib/tokens.ts";
import type { FeeTier } from "./fee-tiers.ts";
import { ensurePermit2Approval } from "./erc20-allowance.ts";
import { extractMintedTokenId } from "./extract-token-id.ts";
import { rememberLocalPool } from "./local-pools.ts";
import { rememberLocalPosition } from "./local-positions.ts";
import { buildSignTypedDataArgs, wrapInMulticall, type Permit2Bundle } from "./permit2-helpers.ts";
import type { HookName } from "./use-create-pool.ts";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface AddLiquidityArgs {
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  /** Hook bound to the pool. Forwarded to the server so PoolKey
   *  reconstruction applies `effectivePoolFee` (dynamic-fee hooks set
   *  `key.fee = 0x800000`). Null/omitted = no-hook pool. */
  hook?: HookName | null;
  amountARaw: string;
  amountBRaw: string;
  /** Optional. Omit for existing-pool adds — the server reads slot0
   *  via StateView and returns the resolved price in the response. */
  sqrtPriceX96?: string;
  slippageBps: number;
}

interface CalldataRes {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  liquidity: string;
  amount0Max: string;
  amount1Max: string;
  tickLower: number;
  tickUpper: number;
  poolKeyHash: `0x${string}`;
  /** Always populated by the server — either echoed from the request
   *  or freshly resolved via StateView.getSlot0. */
  sqrtPriceX96: string;
  /** Non-null when the user's Permit2 → PositionManager allowance for
   *  one or both ERC-20 sides is missing or stale. Client signs the
   *  typed data and wraps the permitBatch into a multicall. */
  permit2: Permit2Bundle | null;
}

interface AddState {
  status:
    | "idle"
    | "creating-pool"
    | "pool-pending"
    | "preparing"
    | "approving"
    | "signing"
    | "pending"
    | "success"
    | "error";
  txHash?: `0x${string}`;
  poolInitTx?: `0x${string}`;
  approvalTx?: `0x${string}`;
  error?: ApiError | Error;
  message?: string;
}

interface PoolCreateCalldataRes {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  poolKey: { currency0: string; currency1: string; sqrtPriceX96: string };
}

export function useAddLiquidity() {
  const { wallets } = useWallets();
  const chainId = BASE_CHAIN_ID;
  const [state, setState] = useState<AddState>({ status: "idle" });

  async function execute(args: AddLiquidityArgs): Promise<`0x${string}` | null> {
    try {
      const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime defensive
      if (!wallet) throw new Error("No wallet connected");
      if (wallet.chainId !== `eip155:${String(chainId)}`) {
        await wallet.switchChain(chainId);
      }
      const chain = CHAIN_INFO[chainId].viemChain;
      const publicClient = createPublicClient({ chain, transport: getRpcTransport(chainId) });
      const owner = wallet.address as `0x${string}`;
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: owner,
        chain,
        transport: custom(hardenProvider(provider, chainId)),
      });

      // Step 0 — initialize the pool if it doesn't exist yet.
      // /api/pools/create/calldata returns 200 with init calldata when
      // the pool needs creating, or 409 (POOL_ALREADY_EXISTS) when it's
      // already on-chain. This makes the create-then-add transition
      // invisible to the caller — one `execute()` does both, with two
      // wallet popups labeled distinctly.
      let poolSqrtPriceX96: string | undefined = args.sqrtPriceX96;
      // Set only when THIS run initializes the pool — the creation tx we
      // surface on the pool detail page. Stays undefined when the pool
      // already existed (we don't have its original init tx then).
      let createdTx: `0x${string}` | undefined;
      setState({ status: "creating-pool", message: "Preparing pool…" });
      try {
        const initRes = await api.post<PoolCreateCalldataRes>("/api/pools/create/calldata", {
          chainId,
          tokenA: args.tokenA,
          tokenB: args.tokenB,
          fee: args.fee,
          hook: args.hook ?? null,
          initialAmount0Raw: args.amountARaw,
          initialAmount1Raw: args.amountBRaw,
        });
        setState({ status: "creating-pool", message: "Confirm pool init in wallet…" });
        const initTx = await walletClient.sendTransaction({
          account: owner,
          chain,
          to: initRes.to,
          data: initRes.data,
          value: BigInt(initRes.value),
        });
        setState({ status: "pool-pending", poolInitTx: initTx, message: "Pool initializing…" });
        await publicClient.waitForTransactionReceipt({ hash: initTx });
        createdTx = initTx;
        poolSqrtPriceX96 = initRes.poolKey.sqrtPriceX96;
        void api.post("/api/pools/create/record", {
          chainId,
          txHash: initTx,
          tokenA: args.tokenA,
          tokenB: args.tokenB,
          fee: args.fee,
          hook: args.hook ?? null,
          outcome: "success",
        });
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== "POOL_ALREADY_EXISTS") throw err;
        // Pool already exists — pull the on-chain price out of the 409 details
        // (the server returns the live PoolKey + sqrtPriceX96 there).
        const details = err.details as { poolKey?: { sqrtPriceX96?: string } } | undefined;
        poolSqrtPriceX96 = details?.poolKey?.sqrtPriceX96 ?? poolSqrtPriceX96;
      }

      setState({ status: "preparing" });
      const calldata = await api.post<CalldataRes>("/api/liquidity/add/calldata", {
        ...args,
        chainId,
        ...(poolSqrtPriceX96 ? { sqrtPriceX96: poolSqrtPriceX96 } : {}),
        deadlineSeconds: Math.floor(Date.now() / 1000) + 1200,
      });

      setState({ status: "approving", message: `Checking ${args.tokenA} approval…` });
      // getToken throws "Unknown token on chain …" for an unsupported
      // symbol, so this preserves the not-available guard while returning
      // non-optional Tokens (avoids the always-defined lint on index access).
      const tA = getToken(args.tokenA, chainId);
      const tB = getToken(args.tokenB, chainId);
      const approvalA = await ensurePermit2Approval(
        walletClient,
        publicClient,
        tA.native ? ZERO : tA.address,
        owner,
      );
      setState({ status: "approving", message: `Checking ${args.tokenB} approval…` });
      const approvalB = await ensurePermit2Approval(
        walletClient,
        publicClient,
        tB.native ? ZERO : tB.address,
        owner,
      );

      let to = calldata.to;
      let data = calldata.data;
      if (calldata.permit2) {
        setState({
          status: "signing",
          message: "Sign Permit2 batch in your wallet…",
          ...(approvalA ? { approvalTx: approvalA } : approvalB ? { approvalTx: approvalB } : {}),
        });
        const signTypedDataArgs = buildSignTypedDataArgs(calldata.permit2.typedData);
        const signature = await walletClient.signTypedData({
          account: owner,
          ...signTypedDataArgs,
        });
        const wrapped = wrapInMulticall(
          owner,
          calldata.permit2.permitBatch,
          signature,
          calldata.data,
          // Route the multicall to the pool's per-hook PositionManager
          // (server-resolved), NOT a hardcoded hero address — otherwise
          // mints on Dynamic Fee / RWA Gate / ALO pools hit the wrong
          // PoolManager and revert.
          calldata.to,
        );
        to = wrapped.to;
        data = wrapped.data;
      }

      setState({
        status: "signing",
        ...(approvalA ? { approvalTx: approvalA } : approvalB ? { approvalTx: approvalB } : {}),
      });
      const txHash = await walletClient.sendTransaction({
        account: owner,
        chain,
        to,
        data,
        value: BigInt(calldata.value),
      });
      setState({ status: "pending", txHash });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const outcome = receipt.status === "success" ? "success" : "failure";

      // Extract the minted PositionManager NFT tokenId from receipt logs
      // so the remove-liquidity flow can reference this position later.
      // calldata.to is the per-hook PositionManager that minted the NFT.
      const tokenId =
        outcome === "success" ? extractMintedTokenId(receipt, owner, calldata.to) : null;

      void api.post("/api/liquidity/add/record", {
        chainId,
        txHash,
        tokenA: args.tokenA,
        tokenB: args.tokenB,
        fee: args.fee,
        hook: args.hook ?? null,
        amountARaw: args.amountARaw,
        amountBRaw: args.amountBRaw,
        liquidity: calldata.liquidity,
        tickLower: calldata.tickLower,
        tickUpper: calldata.tickUpper,
        poolKeyHash: calldata.poolKeyHash,
        sqrtPriceX96: calldata.sqrtPriceX96,
        ...(tokenId ? { tokenId } : {}),
        outcome,
      });

      // Track this pool + position locally so the LP list and
      // Positions tab can show them without a Postgres /
      // subgraph round-trip. On-chain state is still the source of
      // truth; this is purely a client-side breadcrumb.
      if (outcome === "success") {
        rememberLocalPool({
          chainId,
          tokenA: args.tokenA,
          tokenB: args.tokenB,
          fee: args.fee,
          hook: args.hook ?? null,
          txHash,
          ...(createdTx ? { createdTx } : {}),
        });
        if (tokenId) {
          const fmt = (raw: string, decimals: number): string => {
            const r = BigInt(raw);
            const denom = 10n ** BigInt(decimals);
            const whole = r / denom;
            const frac = r % denom;
            if (frac === 0n) return whole.toString();
            const s = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
            return `${whole.toString()}.${s.slice(0, 6)}`;
          };
          rememberLocalPosition({
            chainId,
            tokenId,
            tokenA: args.tokenA,
            tokenB: args.tokenB,
            fee: args.fee,
            hook: args.hook ?? null,
            amountA: fmt(args.amountARaw, tA.decimals),
            amountB: fmt(args.amountBRaw, tB.decimals),
            txHash,
          });
        }
      }

      setState({
        status: outcome === "success" ? "success" : "error",
        txHash,
        ...(outcome === "failure" ? { error: new Error("Transaction reverted") } : {}),
      });
      return txHash;
    } catch (err) {
      const e = err instanceof Error ? err : new Error("add liquidity failed");
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
