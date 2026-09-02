import { useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";
import { SOURCE_CHAIN, type BridgeDestination } from "./bridge-chains.ts";

export type BridgeStatus =
  | "idle"
  | "preparing"
  | "approving"
  | "burning"
  | "attesting"
  | "minting"
  | "success"
  | "error";

export interface BridgeState {
  status: BridgeStatus;
  message?: string;
  /** Burn tx on Base (source). */
  burnTx?: string;
  /** Mint tx on the destination chain. */
  mintTx?: string;
  error?: string;
}

export interface BridgeArgs {
  /** Human-decimal USDC amount, e.g. "10.5". */
  amount: string;
  destination: BridgeDestination;
}

interface ResultStep {
  name?: string;
  state?: string;
  txHash?: string;
}
interface BridgeResultLike {
  state?: string;
  steps?: ResultStep[];
  error?: string;
}

/**
 * Outbound USDC bridge from Base via Circle CCTP (Bridge Kit), signed by the
 * user's Privy wallet. Uses the Forwarding Service so the user only signs
 * approve + burn on Base; Circle mints on the destination — no destination gas
 * or second wallet. Mirrors `use-swap.ts`'s status-machine shape.
 */
export function useBridge() {
  const { wallets } = useWallets();
  const [state, setState] = useState<BridgeState>({ status: "idle" });

  async function execute(args: BridgeArgs): Promise<void> {
    try {
      setState({ status: "preparing", message: "Preparing bridge…" });

      if (wallets.length === 0) throw new Error("No wallet connected.");
      const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
      const owner = wallet.address as `0x${string}`;

      // Sign on Base (approve + burn happen there).
      if (wallet.chainId !== `eip155:${String(BASE_CHAIN_ID)}`) {
        await wallet.switchChain(BASE_CHAIN_ID);
      }
      // Privy's provider is EIP-1193 at runtime. Cast to the adapter's OWN
      // expected provider type (not a viem import) so the build doesn't break
      // when Vercel installs a second copy of viem with a distinct nominal
      // EIP1193Provider type.
      const provider = await wallet.getEthereumProvider();
      type ProviderArg = Parameters<typeof createViemAdapterFromProvider>[0]["provider"];
      const adapter = await createViemAdapterFromProvider({
        provider: provider as unknown as ProviderArg,
      });

      // Fresh kit per run so step handlers don't accumulate across bridges.
      const kit = new BridgeKit();
      kit.on("approve", () => {
        setState((s) => ({ ...s, status: "burning", message: "Starting bridge…" }));
      });
      kit.on("burn", () => {
        setState((s) => ({
          ...s,
          status: "attesting",
          message: "Waiting for Circle attestation…",
        }));
      });
      kit.on("fetchAttestation", () => {
        setState((s) => ({ ...s, status: "minting", message: "Minting on destination…" }));
      });

      setState({ status: "approving", message: "Approve USDC in your wallet…" });

      const result = (await kit.bridge({
        from: { adapter, chain: SOURCE_CHAIN },
        to: { chain: args.destination.sdkName, useForwarder: true, recipientAddress: owner },
        amount: args.amount,
      })) as BridgeResultLike;

      const stepTx = (name: string): string | undefined =>
        result.steps?.find((s) => s.name === name && s.txHash)?.txHash;
      const burnTx = stepTx("burn");
      const mintTx = stepTx("mint");

      if (result.state === "error") {
        const failed = result.steps?.find((s) => s.state === "error");
        throw new Error(failed ? `Bridge failed at ${failed.name ?? "a step"}.` : "Bridge failed.");
      }

      setState({
        status: "success",
        message: "Bridge complete.",
        ...(burnTx ? { burnTx } : {}),
        ...(mintTx ? { mintTx } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Common, actionable cases.
      const friendly = /route|forwarder|unsupported|not supported/i.test(msg)
        ? "This route isn't available right now. Try a different destination network."
        : /rejected|denied|user/i.test(msg)
          ? "You rejected the transaction."
          : msg;
      setState({ status: "error", error: friendly });
    }
  }

  function reset(): void {
    setState({ status: "idle" });
  }

  return { state, execute, reset };
}
