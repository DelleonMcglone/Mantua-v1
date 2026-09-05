/**
 * B8-006 — the agent's contract-execution allowlist.
 *
 * Every calldata execution from an agent's Circle wallet passes through
 * `executeAgentCalldata`, and that single choke point refuses any target
 * not on this list. All callers today build their own targets from server
 * constants, so this is defense in depth: a bug (or a prompt-injected
 * instruction that survives the intent layer) must not be able to aim the
 * agent's wallet at an arbitrary contract.
 *
 * The list is assembled from the registries the server already trusts:
 * the token catalog, the canonical v4 stack, the hook addresses, Permit2,
 * the agentic commerce registry from env, and the sports-market settlement
 * layer (when deployed). Per-market contract addresses are dynamic and
 * join via the builder as those agent flows land — extend the builder,
 * never bypass the check.
 *
 * Plain USDC transfers (createTransferTransaction) are deliberately NOT
 * gated here: sends go to user-chosen recipients under the spending cap,
 * and an EOA recipient is not a contract target.
 */

import { env } from "../../env.ts";
import { SUPPORTED_CHAIN_IDS } from "../chains.ts";
import { MARKETS_BY_CHAIN, MARKETS_PERIPHERY_BY_CHAIN } from "../markets-contracts.ts";
import { getTokens } from "../tokens.ts";
import {
  HOOK_NAMES,
  PERMIT2,
  UNIVERSAL_ROUTER,
  getHookAddress,
  getV4Addresses,
} from "../v4-contracts.ts";

export class TargetNotAllowedError extends Error {
  constructor(target: string) {
    super(
      `Agent contract execution refused: ${target} is not an allowlisted contract. ` +
        `Agent wallets may only call known Mantua/Uniswap/Circle contracts (B8-006).`,
    );
    this.name = "TargetNotAllowedError";
  }
}

function buildAllowlist(): Set<string> {
  const targets = new Set<string>();
  const add = (addr: string | null | undefined) => {
    if (addr && addr.startsWith("0x")) targets.add(addr.toLowerCase());
  };

  add(PERMIT2);
  // UniversalRouter — the agent swap execution path (031).
  add(UNIVERSAL_ROUTER);
  for (const chainId of SUPPORTED_CHAIN_IDS) {
    for (const token of Object.values(getTokens(chainId))) add(token.address);
    const v4 = getV4Addresses(chainId);
    add(v4.poolManager);
    add(v4.positionManager);
    add(v4.stateView);
    add(v4.quoter);
    add(v4.poolSwapTest);
    for (const name of HOOK_NAMES) add(getHookAddress(name, chainId));
  }

  // ERC-8004/8183 agentic-commerce registry, when configured.
  add(env.AGENTIC_COMMERCE_ADDRESS);

  // Sports-market settlement layer, per chain. Individual Market/outcome-
  // token addresses are dynamic — agent flows that touch them extend this
  // via registerDynamicTargets, still through this single builder.
  for (const chainId of SUPPORTED_CHAIN_IDS) {
    const markets = MARKETS_BY_CHAIN[chainId];
    if (markets) {
      add(markets.factory);
      add(markets.resolver);
      add(markets.collateral);
    }
    const periphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
    if (periphery) {
      for (const addr of Object.values(periphery) as (string | null)[]) add(addr);
    }
  }

  return targets;
}

let cache: Set<string> | null = null;

/** Per-market contracts (YES/NO tokens, Market addresses) are minted at
 *  ingest time, so they can't live in the static list. Server code that
 *  reads them from OUR database (the markets table the sweep writes) may
 *  register them here just before executing — the set is process-local,
 *  so registration and execution happen in the same invocation. Never
 *  register anything that came from user input. */
const dynamicTargets = new Set<string>();

export function registerDynamicTargets(addrs: readonly (string | null | undefined)[]): void {
  for (const addr of addrs) {
    if (addr && addr.startsWith("0x")) dynamicTargets.add(addr.toLowerCase());
  }
}

export function isAllowedTarget(target: string): boolean {
  cache ??= buildAllowlist();
  const lower = target.toLowerCase();
  return cache.has(lower) || dynamicTargets.has(lower);
}

/** Throws `TargetNotAllowedError` unless `target` is allowlisted. */
export function assertAllowedTarget(target: string): void {
  if (!isAllowedTarget(target)) throw new TargetNotAllowedError(target);
}

/** Test hook — rebuild the list after env/registry mutation. */
export function resetAllowlistForTests(): void {
  cache = null;
}
