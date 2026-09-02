import { isSupportedChainId, type SupportedChainId } from "@/lib/chains.ts";
import type { TokenSymbol } from "@/lib/tokens.ts";
import type { FeeTier } from "./fee-tiers.ts";
import type { HookName } from "./use-create-pool.ts";

const STORAGE_KEY = "mantua.localPositions.v2";

export type PositionOwner = "user" | "agent";

export interface LocalPosition {
  /** Chain the position was minted on. */
  chainId: SupportedChainId;
  /** PositionManager ERC721 token id minted at add-liquidity time. */
  tokenId: string;
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  hook: HookName | null;
  amountA: string;
  amountB: string;
  /** Uncollected swap fees in raw base units (fees0 = tokenA, fees1 =
   *  tokenB). Present on on-chain-discovered rows; absent on the legacy
   *  localStorage breadcrumb. */
  fees0?: string;
  fees1?: string;
  txHash: string;
  createdAt: number;
  owner?: PositionOwner;
}

export function getLocalPositions(): LocalPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalPosition[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => isSupportedChainId(p.chainId))
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** User-owned positions — what the Positions tab shows. */
export function getUserLocalPositions(): LocalPosition[] {
  return getLocalPositions().filter((p) => (p.owner ?? "user") === "user");
}

export function getAgentLocalPositions(): LocalPosition[] {
  return getLocalPositions().filter((p) => p.owner === "agent");
}

/** How long a just-minted breadcrumb outranks the on-chain read. */
const BREADCRUMB_FRESH_MS = 15 * 60_000;

/**
 * Union the authoritative on-chain position list with FRESH local
 * breadcrumbs. A mint confirms on one RPC node but the discovery read may
 * hit a lagging one, so for a short window the on-chain list can miss a
 * position the user just opened — without this, the new position only
 * appears after a later refresh. Fresh breadcrumbs (minted in the last few
 * minutes) not yet visible on-chain are prepended; older breadcrumbs defer
 * entirely to chain truth so fully-removed positions don't resurrect.
 * `onchain === null` (fetch in flight / failed) falls back to breadcrumbs,
 * preserving the previous behavior.
 */
export function mergeWithFreshBreadcrumbs(
  onchain: LocalPosition[] | null,
  breadcrumbs: LocalPosition[],
): LocalPosition[] {
  if (onchain === null) return breadcrumbs;
  const seen = new Set(onchain.map((p) => `${String(p.chainId)}:${p.tokenId}`));
  const fresh = breadcrumbs.filter(
    (b) =>
      Date.now() - b.createdAt < BREADCRUMB_FRESH_MS &&
      !seen.has(`${String(b.chainId)}:${b.tokenId}`),
  );
  return [...fresh, ...onchain];
}

export function rememberLocalPosition(entry: Omit<LocalPosition, "createdAt">) {
  if (typeof window === "undefined") return;
  try {
    const existing = getLocalPositions();
    // Dedupe on `(chainId, tokenId)` — tokenIds aren't unique across
    // chains, so the composite key prevents cross-chain collisions.
    const others = existing.filter(
      // The chainId check is defensive for future multi-chain support; today
      // SupportedChainId is a single literal so TS sees it as constant.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      (p) => !(p.tokenId === entry.tokenId && p.chainId === entry.chainId),
    );
    const next: LocalPosition = { ...entry, createdAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([next, ...others]));
  } catch {
    // localStorage write failures are non-fatal.
  }
}
