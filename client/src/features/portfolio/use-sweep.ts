import { useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom } from "viem";
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID } from "@/lib/chain.ts";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";
import { hardenProvider, publicClient } from "@/lib/privy/wallet-client.ts";
import { api } from "@/lib/api.ts";

interface SweepTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  tokenId: string;
  pair: string;
}

interface SweepState {
  /** idle → preparing → signing → pending → success | empty | error */
  status: "idle" | "preparing" | "signing" | "pending" | "success" | "empty" | "error";
  txHash?: `0x${string}`;
  /** number of positions collected from */
  sweptCount?: number;
  error?: Error;
}

/**
 * Real "sweep accrued fees" — collects each open position's accrued swap
 * fees on-chain via the per-hook PositionManager (one collect tx per
 * position). No fabricated amounts or hashes: empty when there's nothing to
 * collect, real tx hash(es) when there is.
 */
export function useSweep() {
  const { wallets } = useWallets();
  const [state, setState] = useState<SweepState>({ status: "idle" });

  async function execute(): Promise<void> {
    try {
      const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime defensive
      if (!wallet) throw new Error("No wallet connected");
      if (wallet.chainId !== `eip155:${String(ACTIVE_CHAIN_ID)}`) {
        await wallet.switchChain(ACTIVE_CHAIN_ID);
      }
      const owner = wallet.address as `0x${string}`;
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: owner,
        chain: ACTIVE_CHAIN,
        transport: custom(hardenProvider(provider, BASE_CHAIN_ID)),
      });

      setState({ status: "preparing" });
      const { txs } = await api.post<{ txs: SweepTx[] }>("/api/earnings/sweep/calldata", {});
      if (txs.length === 0) {
        setState({ status: "empty" });
        return;
      }

      let lastHash: `0x${string}` | undefined;
      let swept = 0;
      for (const tx of txs) {
        setState({ status: "signing", sweptCount: swept });
        const txHash = await walletClient.sendTransaction({
          account: owner,
          chain: ACTIVE_CHAIN,
          to: tx.to,
          data: tx.data,
          value: BigInt(tx.value),
        });
        setState({ status: "pending", txHash, sweptCount: swept });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        lastHash = txHash;
        swept += 1;
      }
      setState({
        status: "success",
        sweptCount: swept,
        ...(lastHash ? { txHash: lastHash } : {}),
      });
    } catch (err) {
      setState({ status: "error", error: err instanceof Error ? err : new Error("Sweep failed") });
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
