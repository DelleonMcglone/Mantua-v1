import { createPublicClient, fallback, http } from "viem";
import { base } from "viem/chains";
import { type SupportedChainId } from "./chains.ts";
import { env } from "../env.ts";

/**
 * Base Mainnet public client.
 *
 * Phase 7 / R-006 — the inherited lesson (this file's original header, task
 * 045 §"Flakiness caveat", `contracts.yml`): public RPC hosts rate-limit
 * once the app's polling + quoting traffic concentrates on one, which
 * surfaced as failed swap quotes, missing balances, and Cloudflare 502s
 * under fan-out. So:
 *
 *  - **Production refuses a public primary.** `env.ts` fails the boot when
 *    `BASE_RPC_URL` is a known public host in production (`rpcProviderIssues`).
 *  - **Public hosts are a dev convenience, never a production backstop.**
 *    They are appended only when `BASE_RPC_PUBLIC_FALLBACK` allows it —
 *    default on outside production, off in production (a rate-limited
 *    fallback does not add availability under the load that took the
 *    primary down; it adds 10 s timeouts).
 *  - `BASE_RPC_FALLBACK_URLS` lists additional dedicated endpoints; viem's
 *    `fallback()` rotates to the next host when one errors or rate-limits.
 *  - `http(..., { batch: true })` coalesces concurrent JSON-RPC calls into a
 *    single HTTP request (rate limits count requests, not calls);
 *    `batch: { multicall }` aggregates concurrent `readContract`s into one
 *    Multicall3 `aggregate3` eth_call.
 *  - **Every response is scored per host** (`fallback`'s `onResponse`), so
 *    `rpcHealthSnapshot()` can tell `/api/status` whether blockchain reads
 *    are degraded — the R-005 banner's RPC rung.
 *
 * `RPC_UPSTREAMS` is the one list; the wallet-side proxy (`routes/rpc-proxy.ts`)
 * reads it too, so the two never diverge again.
 */

import { RpcHealthRegistry, resolveRpcUrls, type RpcHealth } from "./rpc-config.ts";

export {
  PUBLIC_BASE_RPC_HOSTS,
  PUBLIC_BASE_RPC_URLS,
  RPC_HOST_FAILURE_THRESHOLD,
  RpcHealthRegistry,
  isPublicRpcUrl,
  parseUrlList,
  resolveRpcUrls,
  rpcProviderIssues,
  type RpcEnv,
  type RpcHealth,
  type RpcHostHealth,
} from "./rpc-config.ts";

/** The one upstream list — the viem client and the wallet proxy share it. */
export const RPC_UPSTREAMS: readonly string[] = resolveRpcUrls(env);

const registry = new RpcHealthRegistry(RPC_UPSTREAMS);

/** Per-host health for `/api/status` (R-005) and operators. */
export function rpcHealthSnapshot(): RpcHealth {
  return registry.snapshot();
}

/** Score an outcome for the host at `index` (the proxy reports through this). */
export function recordRpcOutcome(index: number, ok: boolean, error?: unknown): void {
  registry.record(index, ok, error);
}

// Types are inferred (not annotated `: PublicClient`): viem's generic
// PublicClient default params don't unify with createPublicClient's
// chain-specialized return, which TS reports as a spurious duplicate-type
// conflict. The inferred type is a PublicClient and works for all callers.
const baseClient = createPublicClient({
  chain: base,
  batch: { multicall: { wait: 16 } },
  transport: fallback(
    RPC_UPSTREAMS.map((url, i) =>
      http(url, {
        key: `rpc-${String(i)}`,
        batch: true,
        retryCount: 1,
        retryDelay: 300,
        // A dedicated endpoint answers in well under a second; a host that
        // needs longer is the problem, and the next host should get the call.
        timeout: 8_000,
      }),
    ),
  ),
});

// Score every response per host — the fallback transport exposes the hook
// on its value, not its config.
baseClient.transport.onResponse(({ status, transport, error }) => {
  const key = transport.config.key;
  const index = Number(key.startsWith("rpc-") ? key.slice(4) : NaN);
  if (Number.isInteger(index)) registry.record(index, status === "success", error);
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
