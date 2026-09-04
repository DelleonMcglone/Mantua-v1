/**
 * C-005 (D-111) — EIP-1193 bridge over a sponsored smart-account client.
 *
 * Privy's smart-wallet client (`@privy-io/react-auth/smart-wallets`) exposes
 * a viem SmartAccountClient-shaped surface, but the rest of the app is built
 * against plain viem `WalletClient`s created from an EIP-1193 provider
 * (see `lib/privy/wallet-client.ts`). Rather than teach every feature hook a
 * second client type, this bridge adapts the smart client BACK into an
 * EIP-1193 `request` shape, so `createWalletClient({ transport: custom(...) })`
 * yields the exact same client type the EOA path produces — callers cannot
 * tell the difference, and the flag flips only which transport signs.
 *
 * Routing:
 *  - `eth_sendTransaction`  → smart client (bundler + paymaster; fees/nonce
 *    are the bundler's job — gas fields from the caller are intentionally
 *    dropped, calldata/to/value pass through verbatim)
 *  - `personal_sign` / `eth_signTypedData(_v4)` → smart client signing
 *  - `eth_accounts` / `eth_requestAccounts` / `eth_chainId` → answered locally
 *  - everything else (reads: estimates, receipts, logs…) → the hardened
 *    public transport, same as the EOA path's `hardenProvider`
 *
 * Pure module: no Privy/React imports, injectable seams, unit-testable.
 */

type Hex = `0x${string}`;

export interface RpcRequestArgs {
  method: string;
  params?: unknown;
}

/**
 * The minimal surface this bridge needs from Privy's smart-wallet client.
 * (Structural subset of `SmartWalletClientType`.)
 */
export interface SmartTransactionSender {
  sendTransaction(tx: { to: Hex; data?: Hex; value?: bigint }): Promise<Hex>;
  signMessage(args: { message: string | { raw: Hex } }): Promise<Hex>;
  signTypedData(typedData: Record<string, unknown>): Promise<Hex>;
}

export interface Eip1193Bridge {
  request(args: RpcRequestArgs): Promise<unknown>;
}

function isHex(v: unknown): v is Hex {
  return typeof v === "string" && v.startsWith("0x");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Extract { to, data, value } from an eth_sendTransaction tx object. */
export function toSmartCall(tx: unknown): { to: Hex; data?: Hex; value?: bigint } {
  if (!isRecord(tx)) throw new Error("gasless: malformed transaction request");
  const to = tx["to"];
  if (!isHex(to)) {
    // Contract deployment (no `to`) is not a user flow in this app; refuse
    // loudly instead of silently mis-routing.
    throw new Error("gasless: transaction without `to` is not supported");
  }
  const call: { to: Hex; data?: Hex; value?: bigint } = { to };
  const data = tx["data"] ?? tx["input"];
  if (isHex(data)) call.data = data;
  const value = tx["value"];
  if (isHex(value)) call.value = BigInt(value);
  else if (typeof value === "bigint") call.value = value;
  return call;
}

export function createSmartAccountBridge(opts: {
  smart: SmartTransactionSender;
  /** The smart account (counterfactual) address — NOT the embedded EOA. */
  address: Hex;
  chainId: number;
  /** Read-path escape hatch: the chain's hardened public transport. */
  publicRequest: (args: RpcRequestArgs) => Promise<unknown>;
}): Eip1193Bridge {
  const { smart, address, chainId, publicRequest } = opts;
  const chainIdHex: Hex = `0x${chainId.toString(16)}`;

  return {
    request: async (args: RpcRequestArgs): Promise<unknown> => {
      const params = Array.isArray(args.params) ? (args.params as unknown[]) : [];
      switch (args.method) {
        case "eth_sendTransaction": {
          return smart.sendTransaction(toSmartCall(params[0]));
        }
        case "eth_accounts":
        case "eth_requestAccounts":
          return [address];
        case "eth_chainId":
          return chainIdHex;
        case "personal_sign": {
          // viem orders params [message, address].
          const message = params[0];
          if (isHex(message)) return smart.signMessage({ message: { raw: message } });
          if (typeof message === "string") return smart.signMessage({ message });
          throw new Error("gasless: malformed personal_sign request");
        }
        case "eth_signTypedData":
        case "eth_signTypedData_v4": {
          // viem orders params [address, typedDataJson].
          const payload = params[1];
          const typedData: unknown = typeof payload === "string" ? JSON.parse(payload) : payload;
          if (!isRecord(typedData)) throw new Error("gasless: malformed typed-data request");
          return smart.signTypedData(typedData);
        }
        default:
          return publicRequest(args);
      }
    },
  };
}
