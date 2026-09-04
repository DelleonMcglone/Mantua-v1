/**
 * C-005 (D-111) — the gasless smart-account wallet client hook.
 *
 * `useGaslessWalletClient()` returns an async getter that resolves to a
 * viem WalletClient whose writes are signed by the user's Privy smart
 * wallet (ERC-4337, sponsored by the paymaster configured in the Privy
 * Dashboard) — or `null` whenever the sponsored path is unavailable:
 *  - the `VITE_GASLESS_ENABLED` flag is off (build-time constant), or
 *  - the user has no smart wallet (e.g. external-wallet login — smart
 *    wallets are provisioned over the EMBEDDED signer only), or
 *  - Privy hasn't finished provisioning / the dashboard lacks smart-wallet
 *    config for the chain.
 *
 * `null` means "use the EOA path" — the caller in
 * `lib/privy/wallet-client.ts` falls through to the existing default.
 * A gasless failure must never take the trade path down.
 */
import { useCallback } from "react";
import { createPublicClient, createWalletClient, custom } from "viem";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import type { SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";
import { BASE_CHAIN_ID, CHAIN_INFO, getRpcTransport } from "../chains.ts";
import { GASLESS_CONFIG } from "./config.ts";
import {
  createSmartAccountBridge,
  type RpcRequestArgs,
  type SmartTransactionSender,
} from "./bridge.ts";

// Local read client on the hardened fallback transport (mirrors
// `publicClientFor` in lib/privy/wallet-client.ts; duplicated minimally here
// to keep this module import-acyclic with wallet-client.ts, which imports us).
let cachedPublicRequest: ((args: RpcRequestArgs) => Promise<unknown>) | null = null;
function publicRequest(args: RpcRequestArgs): Promise<unknown> {
  if (!cachedPublicRequest) {
    const client = createPublicClient({
      chain: CHAIN_INFO[BASE_CHAIN_ID].viemChain,
      transport: getRpcTransport(BASE_CHAIN_ID),
    });
    cachedPublicRequest = (a: RpcRequestArgs) =>
      (client.request as (x: RpcRequestArgs) => Promise<unknown>)(a);
  }
  return cachedPublicRequest(args);
}

/** Adapt Privy's smart-wallet client to the bridge's minimal sender surface. */
function toSender(smart: SmartWalletClientType): SmartTransactionSender {
  return {
    sendTransaction: (tx) => {
      // Build the call object field-by-field: exactOptionalPropertyTypes
      // forbids passing explicit `undefined` members.
      const call: { to: `0x${string}`; data?: `0x${string}`; value?: bigint } = { to: tx.to };
      if (tx.data !== undefined) call.data = tx.data;
      if (tx.value !== undefined) call.value = tx.value;
      return smart.sendTransaction(call);
    },
    signMessage: (args) => smart.signMessage(args),
    signTypedData: (typedData) =>
      // Privy types this with viem's full SignTypedDataParameters generics;
      // the bridge hands over the already-structured typed-data payload.
      smart.signTypedData(typedData as unknown as Parameters<typeof smart.signTypedData>[0]),
  };
}

/** Wrap a smart-wallet client into the app's standard viem WalletClient shape. */
function buildGaslessViemClient(smart: SmartWalletClientType) {
  const address = smart.account.address;
  const bridge = createSmartAccountBridge({
    smart: toSender(smart),
    address,
    chainId: BASE_CHAIN_ID,
    publicRequest,
  });
  return createWalletClient({
    account: address,
    chain: CHAIN_INFO[BASE_CHAIN_ID].viemChain,
    transport: custom(bridge),
  });
}

export type GaslessViemClient = ReturnType<typeof buildGaslessViemClient>;
export type GaslessClientGetter = () => Promise<GaslessViemClient | null>;

function useGaslessWalletClientEnabled(): GaslessClientGetter {
  const { getClientForChain } = useSmartWallets();
  return useCallback(async () => {
    try {
      const smart = await getClientForChain({ id: BASE_CHAIN_ID });
      if (!smart) return null;
      return buildGaslessViemClient(smart);
    } catch (err) {
      // Degrade to the EOA path — sponsorship problems must not block trading.
      console.warn("gasless: smart-wallet client unavailable, using standard wallet path", err);
      return null;
    }
  }, [getClientForChain]);
}

function useGaslessWalletClientDisabled(): GaslessClientGetter {
  return useCallback(() => Promise.resolve(null), []);
}

/**
 * Selected once at module load from the build-time flag, so the hook
 * identity is stable for the app's lifetime (rules-of-hooks safe), and the
 * disabled build never touches `useSmartWallets` (whose provider is only
 * mounted when the flag is on — see ./provider.tsx).
 */
export const useGaslessWalletClient: () => GaslessClientGetter = GASLESS_CONFIG.enabled
  ? useGaslessWalletClientEnabled
  : useGaslessWalletClientDisabled;
