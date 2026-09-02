import { createPublicClient, erc20Abi, formatUnits, http, type Chain } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { HTTPFacilitatorClient, decodePaymentRequiredHeader } from "@x402/core/http";
import { withBazaar } from "@x402/extensions/bazaar";
import { and, eq, gte } from "drizzle-orm";
import { env } from "../env.ts";
import { db } from "../db/client.ts";
import { mantuaAuditLog } from "../db/schema/safety.ts";
import { logAudit } from "./audit.ts";
import { logger } from "./logger.ts";

/**
 * x402 nanopayments — HTTP-NATIVE buyer (v2 protocol), replacing the old
 * Circle-CLI wrapper so the marketplace works everywhere the server runs
 * (Vercel included; the CLI was local-only and never present in prod).
 *
 * - Discovery: the x402 Bazaar index on the public facilitator — the same
 *   registry behind Circle's marketplace (agents.circle.com/services).
 * - Payment: a bare request draws HTTP 402 + PAYMENT-REQUIRED (base64 JSON
 *   accepts); `wrapFetchWithPayment` signs an EIP-3009 authorization with the
 *   buyer EOA and retries. The facilitator settles on-chain — the buyer needs
 *   USDC on Base but NO gas.
 * - Buyer wallet: X402_BUYER_PRIVATE_KEY, falling back to
 *   MANTUA_ADMIN_PRIVATE_KEY — the same EOA our x402 SELLER is paid to, so
 *   seller revenue funds buyer spend.
 *
 * Budget guards are unchanged from the CLI era: a per-call ceiling
 * (X402_MAX_CALL_USD), a daily cap summed from the audit log
 * (X402_DAILY_CAP_USD), and an `agent_x402` audit row per payment.
 */

/** The x402 Bazaar index (public, no auth) — hosted on Coinbase's CDP
 *  facilitator; the registry behind the agent marketplaces. */
const BAZAAR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
/** CAIP-2 id for Base mainnet — the x402 settlement rail. Payable the
 *  moment the buyer EOA holds (a few cents of) real USDC on Base. */
const X402_MAINNET = "eip155:8453";
/** Networks the buyer can sign for, in preference order. */
const BUYER_NETWORKS = [X402_MAINNET] as const;
/** Settlement rails: CAIP-2 id → viem chain + native USDC for balance reads. */
interface Rail {
  chain: Chain;
  usdc: `0x${string}`;
  label: string;
}
const RAILS: Record<string, Rail> = {
  [X402_MAINNET]: {
    chain: base,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    label: "Base mainnet",
  },
};
const USDC_DECIMALS = 6;
const FETCH_TIMEOUT_MS = 60_000;
/** Bazaar pages fetched per search (100 items each). */
const BAZAAR_MAX_PAGES = 5;

export interface X402Service {
  name: string;
  description: string;
  price: string;
  chains: string[];
  url: string;
}

export interface X402CallResult {
  service: string;
  chain: string;
  usdCost: number;
  response: unknown;
}

/** Thrown when a paid call cannot proceed; `mayHaveCharged` flags ambiguous cases. */
export class X402Error extends Error {
  readonly mayHaveCharged: boolean;
  constructor(message: string, mayHaveCharged = false) {
    super(message);
    this.name = "X402Error";
    this.mayHaveCharged = mayHaveCharged;
  }
}

// ---- buyer wallet + availability ----

function buyerKey(): `0x${string}` | null {
  const key = env.X402_BUYER_PRIVATE_KEY ?? env.MANTUA_ADMIN_PRIVATE_KEY;
  return key ? (key as `0x${string}`) : null;
}

export function getBuyerAddress(): string | null {
  const key = buyerKey();
  return key ? privateKeyToAccount(key).address : null;
}

/** Kept async for drop-in compatibility with the old CLI probe. */
// eslint-disable-next-line @typescript-eslint/require-await
export async function isX402Available(): Promise<boolean> {
  return env.X402_ENABLED && buyerKey() !== null;
}

// ---- input validation (ported from the CLI wrapper) ----

function cleanKeyword(keyword: unknown): string {
  if (typeof keyword !== "string") throw new X402Error("keyword must be a string");
  // eslint-disable-next-line no-control-regex
  const k = keyword.replace(/[\x00-\x1f]/g, "").trim();
  if (k.length < 1 || k.length > 100) throw new X402Error("keyword must be 1–100 chars");
  return k;
}

function cleanUrl(url: unknown): string {
  if (typeof url !== "string") throw new X402Error("url must be a string");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new X402Error("url is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new X402Error("url must be http(s)");
  }
  return parsed.toString();
}

function cleanMethod(method: unknown): "GET" | "POST" {
  if (method === undefined || method === null) return "GET";
  if (typeof method !== "string") throw new X402Error("method must be GET or POST");
  const m = method.toUpperCase();
  if (m !== "GET" && m !== "POST") throw new X402Error("method must be GET or POST");
  return m;
}

// ---- discovery (x402 Bazaar) ----

/** Loose view of a bazaar accepts entry — v2 uses `amount`, v1 `maxAmountRequired`. */
interface AcceptsLike {
  scheme?: string;
  network?: string;
  amount?: string;
  maxAmountRequired?: string;
}

function pickAccept(accepts: AcceptsLike[] | undefined): AcceptsLike | null {
  if (!accepts?.length) return null;
  for (const net of BUYER_NETWORKS) {
    const hit = accepts.find((a) => a.scheme === "exact" && a.network === net);
    if (hit) return hit;
  }
  return accepts[0] ?? null;
}

function priceUsdFromAccept(a: AcceptsLike | null): number | null {
  const raw = a?.amount ?? a?.maxAmountRequired;
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    return Number(raw) / 10 ** USDC_DECIMALS;
  }
  return null;
}

function toService(r: Record<string, unknown>): X402Service {
  const accepts = r["accepts"] as AcceptsLike[] | undefined;
  const price = priceUsdFromAccept(pickAccept(accepts));
  const meta = (r["metadata"] ?? {}) as Record<string, unknown>;
  const name = r["serviceName"] ?? meta["serviceName"] ?? r["name"];
  return {
    name: typeof name === "string" && name ? name : "unknown",
    description: typeof r["description"] === "string" ? r["description"] : "",
    price: price !== null ? `$${String(price)}` : "?",
    chains: (accepts ?? [])
      .map((a) => a.network ?? "")
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i),
    url: typeof r["resource"] === "string" ? r["resource"] : "",
  };
}

/**
 * Search the Bazaar by keyword. The CDP index only exposes a paginated LIST
 * (no server-side text search), so we page through it and filter locally
 * against name/description/tags/URL.
 */
export async function searchServices(keyword: unknown): Promise<X402Service[]> {
  const query = cleanKeyword(keyword).toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const client = withBazaar(new HTTPFacilitatorClient({ url: BAZAAR_URL }));

  const matches: X402Service[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < BAZAAR_MAX_PAGES; page++) {
    const res = (await client.extensions.bazaar.listResources({
      type: "http",
      limit: 100,
      ...(cursor ? { cursor } : {}),
    })) as { items?: unknown[]; pagination?: { cursor?: string } };
    const items = (res.items ?? []) as Array<Record<string, unknown>>;
    for (const r of items) {
      const hay = [
        r["serviceName"],
        r["description"],
        r["resource"],
        ...(Array.isArray(r["tags"]) ? (r["tags"] as unknown[]) : []),
      ]
        .filter((v): v is string => typeof v === "string")
        .join(" ")
        .toLowerCase();
      if (terms.some((t) => hay.includes(t))) matches.push(toService(r));
      if (matches.length >= 15) return matches;
    }
    cursor = res.pagination?.cursor;
    if (!cursor || items.length === 0) break;
  }
  return matches;
}

// ---- price pre-flight (bare request → 402) ----

interface InspectResult {
  /** null when the endpoint answered 200 without a paywall (free). */
  priceUsd: number | null;
  /** The settlement network the buyer will pay on. */
  network?: string;
  /** The free response body, when the endpoint didn't paywall. */
  freeResponse?: unknown;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildInit(method: "GET" | "POST", data: unknown): RequestInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  };
  if (method === "POST" && data !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(data);
  }
  return init;
}

async function inspectPrice(
  url: string,
  method: "GET" | "POST",
  data: unknown,
): Promise<InspectResult> {
  const res = await fetch(url, buildInit(method, data));
  if (res.status !== 402) {
    if (res.ok) return { priceUsd: null, freeResponse: await parseBody(res) };
    throw new X402Error(`Service pre-flight failed (HTTP ${String(res.status)}).`);
  }
  const header = res.headers.get("payment-required");
  if (!header) throw new X402Error("402 response carried no PAYMENT-REQUIRED header.");
  let accepts: AcceptsLike[];
  try {
    const decoded = decodePaymentRequiredHeader(header) as { accepts?: AcceptsLike[] };
    accepts = decoded.accepts ?? [];
  } catch {
    throw new X402Error("Couldn't decode the service's payment requirements.");
  }
  const payable = accepts.filter(
    (a) => a.scheme === "exact" && BUYER_NETWORKS.includes(a.network as never),
  );
  const chosen = pickAccept(payable);
  if (!chosen) {
    const nets = [...new Set(accepts.map((a) => a.network).filter(Boolean))].join(", ");
    throw new X402Error(
      `This service doesn't settle on a rail the buyer wallet can pay (accepts: ${nets || "unknown"}; buyer pays on Base).`,
    );
  }
  const price = priceUsdFromAccept(chosen);
  if (price === null) throw new X402Error("Couldn't read a price from the payment requirements.");
  return { priceUsd: price, network: chosen.network ?? X402_MAINNET };
}

function railLabel(network: string): string {
  return (RAILS[network] as Rail | undefined)?.label ?? network;
}

/**
 * Pre-flight: the buyer's USDC balance on the settlement rail. Returns null
 * when the rail is unknown or the RPC read fails — fail open, the facilitator
 * is the source of truth; this guard exists only to turn a doomed payment
 * into a clear error before anything is signed.
 */
async function buyerUsdcBalance(network: string, buyer: `0x${string}`): Promise<number | null> {
  // `network` comes from the service's 402 challenge; widen the index result
  // (noUncheckedIndexedAccess is off) so unknown rails are handled.
  const rail = RAILS[network] as Rail | undefined;
  if (!rail) return null;
  try {
    const client = createPublicClient({ chain: rail.chain, transport: http() });
    const bal = await client.readContract({
      address: rail.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [buyer],
    });
    return Number(formatUnits(bal, USDC_DECIMALS));
  } catch (err) {
    logger.warn({ err, network }, "x402: buyer balance pre-flight failed (continuing)");
    return null;
  }
}

// ---- budget (summed from the audit log; no migration) ----

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function getTodayX402Spend(): Promise<number> {
  const rows = await db
    .select({ params: mantuaAuditLog.params })
    .from(mantuaAuditLog)
    .where(
      and(eq(mantuaAuditLog.action, "agent_x402"), gte(mantuaAuditLog.createdAt, startOfUtcDay())),
    );
  let total = 0;
  for (const r of rows) {
    const cost = (r.params as Record<string, unknown> | null)?.["usdCost"];
    if (typeof cost === "number") total += cost;
  }
  return total;
}

// ---- pay (the orchestrated, agent-facing flow) ----

/**
 * Pre-flight price check → budget guards → paid fetch (EIP-3009 via the
 * buyer EOA, facilitator settles) → audit. Free endpoints short-circuit
 * without payment. Throws X402Error on guarded failures; `mayHaveCharged`
 * is true when the failure happened after the payment header was sent.
 */
export async function callPaidService(opts: {
  url: unknown;
  data?: unknown;
  method?: unknown;
}): Promise<X402CallResult> {
  const url = cleanUrl(opts.url);
  const method = cleanMethod(opts.method);
  const key = buyerKey();
  if (!env.X402_ENABLED || !key) throw new X402Error("x402 payments are not enabled.");
  const account = privateKeyToAccount(key);

  const inspected = await inspectPrice(url, method, opts.data);
  if (inspected.priceUsd === null) {
    // No paywall — return the free response, nothing charged.
    return { service: url, chain: "none", usdCost: 0, response: inspected.freeResponse };
  }
  const network = inspected.network ?? X402_MAINNET;
  const price = inspected.priceUsd;
  const perCall = env.X402_MAX_CALL_USD;
  if (price > perCall) {
    throw new X402Error(
      `Service costs $${String(price)}, over the per-call cap of $${String(perCall)}.`,
    );
  }
  const spent = await getTodayX402Spend();
  if (spent + price > env.X402_DAILY_CAP_USD) {
    throw new X402Error(
      `Daily x402 cap $${String(env.X402_DAILY_CAP_USD)} would be exceeded ($${String(spent)} spent today).`,
    );
  }

  const balance = await buyerUsdcBalance(network, account.address);
  if (balance !== null && balance < price) {
    const label = railLabel(network);
    throw new X402Error(
      `Buyer wallet ${account.address} holds only $${balance.toFixed(2)} USDC on ${label}, but this service costs $${String(price)} and settles there. Fund the wallet on ${label} (or use a service on a funded rail). Nothing was charged.`,
    );
  }

  const scheme = new ExactEvmScheme(account);
  let client = new x402Client();
  for (const net of BUYER_NETWORKS) client = client.register(net, scheme);
  const payFetch = wrapFetchWithPayment(fetch, client);

  let res: Response;
  try {
    res = await payFetch(url, buildInit(method, opts.data));
  } catch (err) {
    logger.warn({ err, url }, "x402: paid fetch failed");
    // The wrapper throws before OR after sending the payment header; we
    // can't always tell which, so flag the ambiguity.
    throw new X402Error("Paid call failed.", true);
  }
  if (!res.ok) {
    await logAudit({
      walletAddress: account.address,
      action: "agent_x402",
      outcome: "failure",
      params: { url, method, reason: `http_${String(res.status)}_after_payment` },
    });
    throw new X402Error(
      res.status === 402
        ? `The service rejected the payment (HTTP 402 after paying) — settlement on ${railLabel(network)} likely failed, so the wallet was most likely not charged.`
        : `Payment was sent but the service returned HTTP ${String(res.status)}.`,
      true,
    );
  }
  const response = await parseBody(res);

  await logAudit({
    walletAddress: account.address,
    action: "agent_x402",
    outcome: "success",
    params: { url, method, chain: network, usdCost: price },
  });

  return { service: url, chain: network, usdCost: price, response };
}
