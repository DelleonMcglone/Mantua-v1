import { createPublicClient, fallback, http } from "viem";
import { base } from "viem/chains";
import { type SupportedChainId } from "./chains.ts";
import { env } from "../env.ts";

/**
 * Base Mainnet public client. Public RPC hosts rate-limit once the app's
 * polling + quoting traffic concentrates on one, which surfaced as failed
 * swap quotes and missing balances. Spread the load and degrade gracefully:
 *
 *  - `fallback()` rotates to the next host when one errors or rate-limits.
 *  - `http(..., { batch: true })` coalesces concurrent JSON-RPC calls into a
 *    single HTTP request (rate limits count requests, not calls).
 *  - `batch: { multicall: true }` aggregates concurrent `readContract`s into
 *    one Multicall3 `aggregate3` eth_call (deployed on Base at the canonical
 *    address; declared in viem's base chain def).
 *
 * A custom `BASE_RPC_URL` (e.g. a private Alchemy/QuickNode endpoint) goes
 * first in the list.
 */
const PUBLIC_BASE_RPC_URLS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"] as const;

const rpcUrls = [env.BASE_RPC_URL, ...PUBLIC_BASE_RPC_URLS.filter((u) => u !== env.BASE_RPC_URL)];

// Types are inferred (not annotated `: PublicClient`): viem's generic
// PublicClient default params don't unify with createPublicClient's
// chain-specialized return, which TS reports as a spurious duplicate-type
// conflict. The inferred type is a PublicClient and works for all callers.
const baseClient = createPublicClient({
  chain: base,
  batch: { multicall: { wait: 16 } },
  transport: fallback(
    rpcUrls.map((url) => http(url, { batch: true, retryCount: 1, retryDelay: 300 })),
  ),
});

/** Legacy single-chain alias. Use `getRpcClient(chainId)` in new code. */
export const baseRpcClient = baseClient;

/** Per-chain public client — single chain today: 8453 → Base Mainnet. */
export function getRpcClient(_chainId: SupportedChainId) {
  return baseClient;
}

/**
 * True when an error is a transient RPC/transport failure (rate limit,
 * timeout, connection drop) rather than a deterministic contract revert.
 * Callers use this to fail open / retry instead of surfacing the raw RPC
 * error as if it were an on-chain rejection ("Swap rejected by hook: RPC
 * Request failed… request limit reached").
 */
export function isTransientRpcError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur instanceof Error && !seen.has(cur)) {
    seen.add(cur);
    if (
      /request limit reached|rate limit|too many requests|429|timed? ?out|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/i.test(
        cur.message,
      )
    ) {
      return true;
    }
    cur = cur.cause;
  }
  return false;
}
