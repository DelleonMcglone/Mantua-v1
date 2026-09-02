import { formatUnits } from "viem";
import { logger } from "./logger.ts";

/**
 * Base explorer (Blockscout v2) client — the agent's on-chain "explorer
 * skills" on Base Mainnet: inspect any address, token, or transaction,
 * Etherscan-style. Data comes from the public Blockscout instance (no
 * auth); human-facing links point at BaseScan. Mirrors the defillama.ts
 * pattern: cached() 60s TTL, short timeout, warn + safe fallbacks (callers
 * degrade to "data unavailable" instead of erroring the whole chat turn).
 */

const BASE = "https://base.blockscout.com/api/v2";
export const BASESCAN_WEB = "https://basescan.org";
const TTL_MS = 60_000;
const TIMEOUT_MS = 8_000;

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.value as T;
  const value = await fetcher();
  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

async function getJson(path: string): Promise<unknown> {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, "basescan fetch failed");
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn({ err, path }, "basescan request errored");
    return null;
  }
}

// Blockscout wraps addresses as objects; pull the fields we use.
interface BsAddress {
  hash?: string;
  is_contract?: boolean;
  name?: string | null;
}
function addrHash(a: unknown): string {
  const h = (a as BsAddress | null)?.hash;
  return typeof h === "string" ? h : "";
}
function addrIsContract(a: unknown): boolean {
  return (a as BsAddress | null)?.is_contract === true;
}
function addrName(a: unknown): string | null {
  const n = (a as BsAddress | null)?.name;
  return typeof n === "string" && n.length > 0 ? n : null;
}

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;

export function isEvmAddress(s: string): boolean {
  return ADDR_RE.test(s);
}
export function isTxHash(s: string): boolean {
  return HASH_RE.test(s);
}

// ─── Addresses ───────────────────────────────────────────────────────────────

export interface BaseAddressInfo {
  address: string;
  /** Native gas balance (ETH, 18dp), human units. */
  nativeBalance: string;
  isContract: boolean;
  label: string | null;
  hasTokenTransfers: boolean;
  explorerUrl: string;
}

export async function getAddressInfo(address: string): Promise<BaseAddressInfo | null> {
  if (!isEvmAddress(address)) return null;
  return cached(`addr:${address.toLowerCase()}`, async () => {
    const d = (await getJson(`/addresses/${address}`)) as Record<string, unknown> | null;
    if (!d) return null;
    const coin = typeof d["coin_balance"] === "string" ? d["coin_balance"] : "0";
    return {
      address,
      nativeBalance: formatUnits(BigInt(coin || "0"), 18),
      isContract: d["is_contract"] === true || typeof d["creator_address_hash"] === "string",
      label: typeof d["name"] === "string" && d["name"] ? d["name"] : null,
      hasTokenTransfers: d["has_token_transfers"] === true,
      explorerUrl: `${BASESCAN_WEB}/address/${address}`,
    };
  });
}

export interface BaseTx {
  hash: string;
  from: string;
  to: string;
  method: string | null;
  valueNative: string;
  status: string;
  timestamp: string;
}

export async function getAddressTransactions(address: string, limit = 10): Promise<BaseTx[]> {
  if (!isEvmAddress(address)) return [];
  return cached(`addrtx:${address.toLowerCase()}:${String(limit)}`, async () => {
    const d = (await getJson(`/addresses/${address}/transactions`)) as {
      items?: Record<string, unknown>[];
    } | null;
    return (d?.items ?? []).slice(0, limit).map((i) => ({
      hash: typeof i["hash"] === "string" ? i["hash"] : "",
      from: addrHash(i["from"]),
      to: addrHash(i["to"]),
      method: typeof i["method"] === "string" ? i["method"] : null,
      valueNative: formatUnits(BigInt(typeof i["value"] === "string" ? i["value"] : "0"), 18),
      status: typeof i["status"] === "string" ? i["status"] : "unknown",
      timestamp: typeof i["timestamp"] === "string" ? i["timestamp"] : "",
    }));
  });
}

export interface BaseTokenTransfer {
  token: string;
  tokenAddress: string;
  direction: "in" | "out";
  amount: string;
  counterparty: string;
  counterpartyIsContract: boolean;
  txHash: string;
  timestamp: string;
}

export async function getAddressTokenTransfers(
  address: string,
  limit = 15,
): Promise<BaseTokenTransfer[]> {
  if (!isEvmAddress(address)) return [];
  return cached(`addrtt:${address.toLowerCase()}:${String(limit)}`, async () => {
    const d = (await getJson(`/addresses/${address}/token-transfers`)) as {
      items?: Record<string, unknown>[];
    } | null;
    const self = address.toLowerCase();
    const out: BaseTokenTransfer[] = [];
    for (const i of (d?.items ?? []).slice(0, limit)) {
      const token = i["token"] as Record<string, unknown> | null;
      const total = i["total"] as Record<string, unknown> | null;
      const decimals = Number(
        (total?.["decimals"] as string | undefined) ??
          (token?.["decimals"] as string | undefined) ??
          "18",
      );
      const rawVal = typeof total?.["value"] === "string" ? total["value"] : "0";
      const fromH = addrHash(i["from"]);
      const toH = addrHash(i["to"]);
      const incoming = toH.toLowerCase() === self;
      out.push({
        token: typeof token?.["symbol"] === "string" ? token["symbol"] : "?",
        tokenAddress: typeof token?.["address_hash"] === "string" ? token["address_hash"] : "",
        direction: incoming ? "in" : "out",
        amount: formatUnits(BigInt(rawVal || "0"), Number.isFinite(decimals) ? decimals : 18),
        counterparty: incoming ? fromH : toH,
        counterpartyIsContract: incoming ? addrIsContract(i["from"]) : addrIsContract(i["to"]),
        txHash: typeof i["transaction_hash"] === "string" ? i["transaction_hash"] : "",
        timestamp: typeof i["timestamp"] === "string" ? i["timestamp"] : "",
      });
    }
    return out;
  });
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

export interface BaseTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  holdersCount: number;
  explorerUrl: string;
}

export async function getTokenInfo(address: string): Promise<BaseTokenInfo | null> {
  if (!isEvmAddress(address)) return null;
  return cached(`tok:${address.toLowerCase()}`, async () => {
    const d = (await getJson(`/tokens/${address}`)) as Record<string, unknown> | null;
    if (!d) return null;
    const decimals = Number(typeof d["decimals"] === "string" ? d["decimals"] : "18");
    const supply = typeof d["total_supply"] === "string" ? d["total_supply"] : "0";
    return {
      address,
      name: typeof d["name"] === "string" ? d["name"] : "?",
      symbol: typeof d["symbol"] === "string" ? d["symbol"] : "?",
      decimals,
      totalSupply: formatUnits(BigInt(supply || "0"), Number.isFinite(decimals) ? decimals : 18),
      holdersCount: Number(typeof d["holders_count"] === "string" ? d["holders_count"] : "0"),
      explorerUrl: `${BASESCAN_WEB}/token/${address}`,
    };
  });
}

export interface BaseTokenHolder {
  address: string;
  isContract: boolean;
  label: string | null;
  balance: string;
  pctOfSupply: number;
}

export interface BaseTokenHolders {
  holders: BaseTokenHolder[];
  /** Share of total supply held by the top ≤10 holders, in percent. */
  top10Pct: number;
}

export async function getTokenHolders(address: string, limit = 10): Promise<BaseTokenHolders> {
  if (!isEvmAddress(address)) return { holders: [], top10Pct: 0 };
  return cached(`tokh:${address.toLowerCase()}:${String(limit)}`, async () => {
    const [info, d] = await Promise.all([
      getTokenInfo(address),
      getJson(`/tokens/${address}/holders`) as Promise<{
        items?: Record<string, unknown>[];
      } | null>,
    ]);
    const decimals = info?.decimals ?? 18;
    const supplyNum = Number(info?.totalSupply ?? "0");
    const holders: BaseTokenHolder[] = (d?.items ?? []).slice(0, limit).map((i) => {
      const raw = typeof i["value"] === "string" ? i["value"] : "0";
      const bal = formatUnits(BigInt(raw || "0"), decimals);
      return {
        address: addrHash(i["address"]),
        isContract: addrIsContract(i["address"]),
        label: addrName(i["address"]),
        balance: bal,
        pctOfSupply: supplyNum > 0 ? (Number(bal) / supplyNum) * 100 : 0,
      };
    });
    const top10Pct = holders.slice(0, 10).reduce((s, h) => s + h.pctOfSupply, 0);
    return { holders, top10Pct };
  });
}

// ─── Transactions ────────────────────────────────────────────────────────────

export interface BaseTxDetail {
  hash: string;
  status: string;
  method: string | null;
  from: string;
  to: string;
  valueNative: string;
  feeNative: string;
  timestamp: string;
  blockNumber: number;
  tokenMovements: { token: string; from: string; to: string; amount: string }[];
  explorerUrl: string;
}

export async function getTransactionInfo(hash: string): Promise<BaseTxDetail | null> {
  if (!isTxHash(hash)) return null;
  return cached(`tx:${hash.toLowerCase()}`, async () => {
    const d = (await getJson(`/transactions/${hash}`)) as Record<string, unknown> | null;
    if (!d || typeof d["hash"] !== "string") return null;
    const fee = d["fee"] as Record<string, unknown> | null;
    const transfers = Array.isArray(d["token_transfers"])
      ? (d["token_transfers"] as Record<string, unknown>[])
      : [];
    return {
      hash: d["hash"],
      status: typeof d["status"] === "string" ? d["status"] : "unknown",
      method: typeof d["method"] === "string" ? d["method"] : null,
      from: addrHash(d["from"]),
      to: addrHash(d["to"]),
      valueNative: formatUnits(BigInt(typeof d["value"] === "string" ? d["value"] : "0"), 18),
      feeNative: formatUnits(BigInt(typeof fee?.["value"] === "string" ? fee["value"] : "0"), 18),
      timestamp: typeof d["timestamp"] === "string" ? d["timestamp"] : "",
      blockNumber: typeof d["block_number"] === "number" ? d["block_number"] : 0,
      tokenMovements: transfers.slice(0, 12).map((t) => {
        const token = t["token"] as Record<string, unknown> | null;
        const total = t["total"] as Record<string, unknown> | null;
        const decimals = Number(
          (total?.["decimals"] as string | undefined) ??
            (token?.["decimals"] as string | undefined) ??
            "18",
        );
        return {
          token: typeof token?.["symbol"] === "string" ? token["symbol"] : "?",
          from: addrHash(t["from"]),
          to: addrHash(t["to"]),
          amount: formatUnits(
            BigInt(typeof total?.["value"] === "string" ? total["value"] : "0"),
            Number.isFinite(decimals) ? decimals : 18,
          ),
        };
      }),
      explorerUrl: `${BASESCAN_WEB}/tx/${hash}`,
    };
  });
}

// ─── Whale-signal summary (per the on-chain analysis playbook) ───────────────

export interface WhaleSignals {
  /** Net human-unit flow per token over the inspected window (+ = accumulating). */
  netFlows: { token: string; net: number; in: number; out: number }[];
  /** Stables→tokens or tokens→stables conversions spotted (heuristic). */
  notes: string[];
}

const STABLES = new Set(["USDC", "EURC"]);

/** Summarize accumulation/selling + stables↔tokens rotation from transfers. */
export function summarizeWhaleSignals(transfers: BaseTokenTransfer[]): WhaleSignals {
  const flow = new Map<string, { in: number; out: number }>();
  for (const t of transfers) {
    const f = flow.get(t.token) ?? { in: 0, out: 0 };
    const amt = Number(t.amount) || 0;
    if (t.direction === "in") f.in += amt;
    else f.out += amt;
    flow.set(t.token, f);
  }
  const netFlows = [...flow.entries()].map(([token, f]) => ({
    token,
    net: f.in - f.out,
    in: f.in,
    out: f.out,
  }));
  const notes: string[] = [];
  const stablesOut = netFlows.some((n) => STABLES.has(n.token) && n.net < 0);
  const tokensIn = netFlows.some((n) => !STABLES.has(n.token) && n.net > 0);
  const stablesIn = netFlows.some((n) => STABLES.has(n.token) && n.net > 0);
  const tokensOut = netFlows.some((n) => !STABLES.has(n.token) && n.net < 0);
  if (stablesOut && tokensIn) notes.push("Rotating stables into tokens (risk-on).");
  if (tokensOut && stablesIn)
    notes.push("Rotating tokens into stables (risk-off / taking profit).");
  for (const n of netFlows) {
    if (n.net > 0 && n.in > 0 && n.out === 0) notes.push(`Accumulating ${n.token}.`);
    if (n.net < 0 && n.out > 0 && n.in === 0) notes.push(`Distributing/selling ${n.token}.`);
  }
  return { netFlows, notes };
}
