import { useState } from "react";
import { hardenProvider } from "@/lib/privy/wallet-client.ts";
import { useWallets } from "@privy-io/react-auth";
import { createPublicClient, createWalletClient, custom } from "viem";
import { useCurrentChainId } from "@/lib/chain-context.tsx";
import { CHAIN_INFO, getRpcTransport } from "@/lib/chains.ts";
import { ApiError, api } from "@/lib/api.ts";
import { type TokenSymbol } from "@/lib/tokens.ts";
import type { FeeTier } from "./fee-tiers.ts";

export type HookName = "stable-protection" | "dynamic-fee";

interface CalldataReq {
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  hook?: HookName | null;
  initialAmount0Raw: string;
  initialAmount1Raw: string;
}

interface CalldataRes {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  poolKey: { currency0: string; currency1: string; sqrtPriceX96: string };
}

interface CreateState {
  status: "idle" | "preparing" | "signing" | "pending" | "success" | "error" | "exists";
  txHash?: `0x${string}`;
  poolKey?: CalldataRes["poolKey"];
  error?: ApiError | Error;
}

interface ExistingPoolDetails {
  poolKey: CalldataRes["poolKey"];
  hook: HookName | null;
}

function existingPoolFromError(err: unknown): ExistingPoolDetails | null {
  if (!(err instanceof ApiError) || err.code !== "POOL_ALREADY_EXISTS") return null;
  const d = err.details as ExistingPoolDetails | undefined;
  if (!d?.poolKey) return null;
  return d;
}

export function useCreatePool() {
  const { wallets } = useWallets();
  const chainId = useCurrentChainId();
  const [state, setState] = useState<CreateState>({ status: "idle" });

  async function execute(req: CalldataReq): Promise<`0x${string}` | null> {
    try {
      const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!wallet) throw new Error("No wallet connected");
      const targetEip = `eip155:${String(chainId)}`;
      if (wallet.chainId !== targetEip) {
        await wallet.switchChain(chainId);
      }

      const chain = CHAIN_INFO[chainId].viemChain;
      const publicClient = createPublicClient({ chain, transport: getRpcTransport(chainId) });

      setState({ status: "preparing" });
      const calldata = await api.post<CalldataRes>("/api/pools/create/calldata", {
        ...req,
        chainId,
      });

      setState({ status: "signing", poolKey: calldata.poolKey });
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: wallet.address as `0x${string}`,
        chain,
        transport: custom(hardenProvider(provider, chainId)),
      });
      const txHash = await walletClient.sendTransaction({
        account: wallet.address as `0x${string}`,
        chain,
        to: calldata.to,
        data: calldata.data,
        value: BigInt(calldata.value),
      });
      setState({ status: "pending", txHash, poolKey: calldata.poolKey });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const outcome = receipt.status === "success" ? "success" : "failure";

      void api.post("/api/pools/create/record", {
        chainId,
        txHash,
        tokenA: req.tokenA,
        tokenB: req.tokenB,
        fee: req.fee,
        outcome,
      });

      setState({
        status: outcome === "success" ? "success" : "error",
        txHash,
        poolKey: calldata.poolKey,
        ...(outcome === "failure" ? { error: new Error("Transaction reverted") } : {}),
      });
      return txHash;
    } catch (err) {
      const existing = existingPoolFromError(err);
      if (existing) {
        const e = err instanceof Error ? err : new Error("Pool already exists");
        setState({ status: "exists", poolKey: existing.poolKey, error: e });
        return null;
      }
      const e = err instanceof Error ? err : new Error("create pool failed");
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
