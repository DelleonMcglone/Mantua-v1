import { useState } from "react";
import { hardenProvider, publicClientFor } from "@/lib/privy/wallet-client.ts";
import { useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom } from "viem";
import { BASE_CHAIN_ID, CHAIN_INFO } from "@/lib/chains.ts";
import { ApiError, api } from "@/lib/api.ts";

export interface RemoveArgs {
  /** Either the DB UUID (Mantua-tracked) … */
  positionId?: string;
  /** … or the on-chain PositionManager ERC721 id (locally-tracked positions
   *  whose DB row never landed). Exactly one must be set. */
  tokenId?: string;
  /** The position's pool hook address — disambiguates the per-hook
   *  PositionManager when removing by tokenId (ids collide across PMs).
   *  Null = no-hook (hero) stack. */
  hookAddress?: string | null;
  percentage: number;
  slippageBps: number;
}

interface CalldataRes {
  to: `0x${string}`;
  data: `0x${string}`;
  amount0Min: string;
  amount1Min: string;
  amount0Estimate: string;
  amount1Estimate: string;
  isFullExit: boolean;
  liquidityToRemove: string;
  positionLiquidity: string;
}

interface RemoveState {
  status: "idle" | "preparing" | "signing" | "pending" | "success" | "error";
  txHash?: `0x${string}`;
  error?: ApiError | Error;
}

export function useRemoveLiquidity() {
  const chainId = BASE_CHAIN_ID;
  const { wallets } = useWallets();
  const [state, setState] = useState<RemoveState>({ status: "idle" });

  async function execute(args: RemoveArgs): Promise<`0x${string}` | null> {
    try {
      const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime defensive
      if (!wallet) throw new Error("No wallet connected");
      if (wallet.chainId !== `eip155:${String(chainId)}`) {
        await wallet.switchChain(chainId);
      }
      const owner = wallet.address as `0x${string}`;
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: owner,
        chain: CHAIN_INFO[chainId].viemChain,
        transport: custom(hardenProvider(provider, chainId)),
      });

      setState({ status: "preparing" });
      const calldata = await api.post<CalldataRes>("/api/liquidity/remove/calldata", {
        ...args,
        chainId,
        deadlineSeconds: Math.floor(Date.now() / 1000) + 1200,
      });

      setState({ status: "signing" });
      const txHash = await walletClient.sendTransaction({
        account: owner,
        chain: CHAIN_INFO[chainId].viemChain,
        to: calldata.to,
        data: calldata.data,
      });
      setState({ status: "pending", txHash });

      const receipt = await publicClientFor(chainId).waitForTransactionReceipt({ hash: txHash });
      const outcome = receipt.status === "success" ? "success" : "failure";

      void api.post("/api/liquidity/remove/record", {
        txHash,
        ...(args.positionId ? { positionId: args.positionId } : {}),
        ...(args.tokenId ? { tokenId: args.tokenId } : {}),
        liquidityRemoved: calldata.liquidityToRemove,
        isFullExit: calldata.isFullExit,
        outcome,
      });

      setState({
        status: outcome === "success" ? "success" : "error",
        txHash,
        ...(outcome === "failure" ? { error: new Error("Transaction reverted") } : {}),
      });
      return txHash;
    } catch (err) {
      const e = err instanceof Error ? err : new Error("remove liquidity failed");
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
