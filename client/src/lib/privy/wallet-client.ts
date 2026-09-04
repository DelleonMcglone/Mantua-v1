import { useCallback } from "react";
import { useWallets } from "@privy-io/react-auth";
import { createPublicClient, createWalletClient, custom } from "viem";
// C-005 gasless hook point (D-111): resolves to a no-op unless VITE_GASLESS_ENABLED.
import { useGaslessWalletClient } from "../gasless/use-gasless-wallet-client.ts";
import { BASE_CHAIN_ID, CHAIN_INFO, getRpcTransport, type SupportedChainId } from "../chains.ts";

/**
 * Per-chain public viem clients for read-only chain calls, on the
 * hardened proxy-first fallback transport (see getRpcTransport).
 *
 * Bug fix: explicit `PublicClient` / `WalletClient` type annotations clash
 * with Privy's bundled (porto-vendored) viem under
 * `exactOptionalPropertyTypes: true`. Annotations removed; types are
 * inferred. Runtime behavior unchanged.
 */
function makePublicClient(chainId: SupportedChainId) {
  return createPublicClient({
    chain: CHAIN_INFO[chainId].viemChain,
    transport: getRpcTransport(chainId),
  });
}

type AppPublicClient = ReturnType<typeof makePublicClient>;

const publicClients = new Map<SupportedChainId, AppPublicClient>();

/** The read client for a chain (lazily created, cached). */
export function publicClientFor(chainId: SupportedChainId): AppPublicClient {
  let client = publicClients.get(chainId);
  if (!client) {
    client = makePublicClient(chainId);
    publicClients.set(chainId, client);
  }
  return client;
}

/**
 * LEGACY single-chain read client — predates multi-chain. Sports-market
 * reads (YES balances etc.) keep using this; chain-aware code uses
 * `publicClientFor(chainId)`.
 */
export const publicClient = publicClientFor(BASE_CHAIN_ID);

interface Eip1193RequestArgs {
  method: string;
  params?: unknown;
}
interface RequestableProvider {
  request(args: Eip1193RequestArgs): Promise<unknown>;
}

/**
 * Read-only JSON-RPC methods viem issues while preparing/tracking a write
 * (gas price, estimation, nonce, receipts…). These are safe to serve from
 * any public node, so we route them through the hardened multi-host
 * fallback transport instead of the wallet provider.
 */
const PUBLIC_RPC_METHODS = new Set([
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_estimateGas",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_call",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getCode",
  "eth_getLogs",
]);

/**
 * Wrap a Privy EIP-1193 provider so read-only RPC (eth_gasPrice /
 * eth_estimateGas / receipts…) goes through the chain's hardened fallback
 * transport (batching, retries) while signing + broadcast stay with the
 * wallet. Privy's provider proxies reads through a single upstream that
 * rate-limits under load ("Custom eth_gasPrice: Request is being rate
 * limited"), which made approve/write flows fail even when the app's own
 * read path was healthy. Use with viem's `custom()` transport, which only
 * needs `request`. `chainId` picks the read transport AND fills the tx
 * chainId — it must be the chain the wallet is on.
 */
export function hardenProvider(
  provider: RequestableProvider,
  chainId: SupportedChainId,
): RequestableProvider {
  const chainClient = publicClientFor(chainId);
  return {
    request: async (args: Eip1193RequestArgs) => {
      if (PUBLIC_RPC_METHODS.has(args.method)) {
        return (chainClient.request as (a: Eip1193RequestArgs) => Promise<unknown>)(args);
      }
      // Take Privy's RPC out of the write path entirely. For JSON-RPC
      // accounts viem skips fee preparation, and Privy's embedded wallet
      // fills gas/nonce itself against a single upstream we don't control
      // ("RPC 0x4cef52 Custom eth_gasPrice: Request is being rate
      // limited"). So: build the FULL transaction ourselves through the
      // hardened fallback transport (fees, gas, nonce, chainId), have the
      // wallet only SIGN it (eth_signTransaction — supported by Privy's
      // embedded wallet), and broadcast the raw tx through the hardened
      // transport too. Falls back to a plain (pre-filled)
      // eth_sendTransaction for wallets that don't expose signing.
      if (args.method === "eth_sendTransaction" && Array.isArray(args.params)) {
        const [tx, ...restParams] = args.params as [Record<string, unknown>, ...unknown[]];
        const filled = { ...tx };
        const pub = chainClient.request as (a: Eip1193RequestArgs) => Promise<unknown>;
        try {
          if (!filled["gasPrice"] && !filled["maxFeePerGas"]) {
            filled["gasPrice"] = `0x${(await chainClient.getGasPrice()).toString(16)}`;
          }
          if (!filled["gas"]) {
            const est = (await pub({ method: "eth_estimateGas", params: [tx] })) as string;
            // 25% headroom — estimates on hook pools can run tight.
            filled["gas"] = `0x${((BigInt(est) * 125n) / 100n).toString(16)}`;
          }
          if (!filled["nonce"] && typeof filled["from"] === "string") {
            filled["nonce"] = await pub({
              method: "eth_getTransactionCount",
              params: [filled["from"], "pending"],
            });
          }
          if (!filled["chainId"]) {
            filled["chainId"] = `0x${chainId.toString(16)}`;
          }
          if (!filled["value"]) filled["value"] = "0x0";
        } catch {
          // Leave missing fields for the wallet to fill on the fallback path.
        }
        // Preferred path: wallet signs, we broadcast.
        if (filled["gasPrice"] && filled["gas"] && filled["nonce"]) {
          try {
            const signed = await provider.request({
              method: "eth_signTransaction",
              params: [filled],
            });
            const rawTx =
              typeof signed === "string"
                ? signed
                : ((signed as { raw?: string } | null)?.raw ?? null);
            if (rawTx) {
              return await pub({ method: "eth_sendRawTransaction", params: [rawTx] });
            }
          } catch {
            // Wallet doesn't support eth_signTransaction (or declined) —
            // fall through to the wallet's own send with pre-filled fields.
          }
        }
        return provider.request({ ...args, params: [filled, ...restParams] });
      }
      return provider.request(args);
    },
  };
}

/**
 * P2-013 — bridge from Privy's active wallet to a viem WalletClient on
 * the currently SELECTED chain. Returns null if no wallet is connected.
 * Caller is responsible for waiting on the Privy `ready` flag before
 * invoking.
 *
 * Chain assertion: if the active wallet is on a different chain, an
 * automatic `switchChain` to the selected chain is attempted first;
 * failure throws naming the selected chain.
 */
export function useChainWalletClient() {
  const { wallets } = useWallets();
  // C-005 gasless hook point (D-111): when the gasless flag is on and the
  // user has a provisioned smart wallet, writes route through the sponsored
  // smart-account client (same viem WalletClient shape); otherwise the
  // getter resolves null and the EOA path below stays the default.
  const getGaslessClient = useGaslessWalletClient();
  const chainId = BASE_CHAIN_ID;

  return useCallback(async () => {
    const gasless = await getGaslessClient();
    if (gasless) return gasless;

    const active = wallets.find((w) => w.walletClientType === "privy") ?? wallets.at(0);
    if (!active) return null;

    const info = CHAIN_INFO[chainId];
    if (active.chainId && active.chainId !== `eip155:${String(chainId)}`) {
      try {
        await active.switchChain(chainId);
      } catch {
        throw new Error(
          "Your wallet is connected to a different network. Approve the network switch in your wallet to continue.",
        );
      }
    }

    const provider = await active.getEthereumProvider();
    return createWalletClient({
      account: active.address as `0x${string}`,
      chain: info.viemChain,
      transport: custom(hardenProvider(provider, chainId)),
    });
  }, [wallets, chainId, getGaslessClient]);
}
