/**
 * Phase 17 (MP-004) — the x402 service catalog: every paid surface Mantua
 * sells to external agents, with its route, default price, and auth mode.
 *
 * This module is the single pricing source of truth — handlers, 402
 * metadata, the future OpenAPI parity tests, and the offerings doc all read
 * from it. Price changes are one-line diffs here and nowhere else; handlers
 * must never hardcode a price.
 *
 * Auth modes (spec §Service catalog):
 *  - "payment"           — payment IS the auth; anyone who pays gets served.
 *  - "allowlist+payment" — pre-settlement payer allowlist ON TOP of payment
 *                          (sports-intelligence pilot). The allowlist comes
 *                          from X402_SPORTS_INTEL_ALLOWLIST; an empty or
 *                          absent list keeps the service dark.
 */

/** The seven sellable services. `specRef` points at the unpaid OpenAPI doc. */
export type X402ServiceId =
  | "market-discovery"
  | "market-intelligence"
  | "trading-quote"
  | "trading-calldata"
  | "portfolio-exposure"
  | "hedging"
  | "sports-intelligence";

export type X402ServiceAuth = "payment" | "allowlist+payment";

/** Coarse grouping for the machine-readable services index (services.json). */
export type X402ServiceFamily =
  | "market-discovery"
  | "market-intelligence"
  | "trading"
  | "portfolio-exposure"
  | "hedging"
  | "sports-intelligence";

export interface X402ServiceDef {
  id: X402ServiceId;
  method: "GET" | "POST";
  /** Full mounted path — paid services live under /api/x402/v1. */
  path: string;
  /** Default price in USD; the Gateway rail exists so sub-cent prices work. */
  priceUsd: string;
  auth: X402ServiceAuth;
  /** Coarse service family for the machine-readable services index. */
  family: X402ServiceFamily;
  /** 402 metadata, OpenAPI description, marketplace listing copy. */
  summary: string;
  /** Unpaid public OpenAPI document for this service (listing prerequisite). */
  specRef: string;
}

/** CAIP-2 id for Base Mainnet — x402's USDC settlement network. */
export const X402_NETWORK = "eip155:8453";

export const X402_SERVICES: readonly X402ServiceDef[] = [
  {
    id: "market-discovery",
    method: "GET",
    path: "/api/x402/v1/markets/discover",
    priceUsd: "0.001",
    auth: "payment",
    family: "market-discovery",
    summary: "Filterable upcoming sports market slate with liquidity and popularity",
    specRef: "/api/x402/openapi/market-discovery.json",
  },
  {
    id: "market-intelligence",
    method: "GET",
    path: "/api/x402/v1/intelligence/market",
    priceUsd: "0.01",
    auth: "payment",
    family: "market-intelligence",
    summary: "Win probability, liquidity, price movement, and sports context for one market",
    specRef: "/api/x402/openapi/market-intelligence.json",
  },
  {
    id: "trading-quote",
    method: "POST",
    path: "/api/x402/v1/trading/quote",
    priceUsd: "0.005",
    auth: "payment",
    family: "trading",
    summary: "Pre-trade quote for one outcome-token market trade, with remaining daily cap",
    specRef: "/api/x402/openapi/trading-quote.json",
  },
  {
    id: "trading-calldata",
    method: "POST",
    path: "/api/x402/v1/trading/calldata",
    priceUsd: "0.02",
    auth: "payment",
    family: "trading",
    summary: "Execution-ready market trade calldata; the caller signs with its own wallet",
    specRef: "/api/x402/openapi/trading-calldata.json",
  },
  {
    id: "portfolio-exposure",
    method: "GET",
    path: "/api/x402/v1/portfolio/exposure",
    priceUsd: "0.005",
    auth: "payment",
    family: "portfolio-exposure",
    summary:
      "Positions, portfolio value, and exposure for any Base address — public chain state only",
    specRef: "/api/x402/openapi/portfolio-exposure.json",
  },
  {
    id: "hedging",
    method: "GET",
    path: "/api/x402/v1/hedging/plan",
    priceUsd: "0.01",
    auth: "payment",
    family: "hedging",
    summary: "Predefined hedge-strategy templates as concrete quote-ready legs — arms nothing",
    specRef: "/api/x402/openapi/hedging.json",
  },
  {
    id: "sports-intelligence",
    method: "GET",
    path: "/api/x402/v1/sports/context",
    priceUsd: "0.01",
    auth: "allowlist+payment",
    family: "sports-intelligence",
    summary: "Honesty-status game context and live odds for allowlisted partners",
    specRef: "/api/x402/openapi/sports-intelligence.json",
  },
];

export function getX402ServiceDef(id: string): X402ServiceDef | undefined {
  return X402_SERVICES.find((s) => s.id === id);
}

export function findX402ServiceByPath(method: string, path: string): X402ServiceDef | undefined {
  return X402_SERVICES.find((s) => s.method === method && s.path === path);
}

/** The service's dollar price as the x402 `price` string ("$0.005"). */
export function x402PriceString(def: X402ServiceDef): string {
  return `$${def.priceUsd}`;
}

/** Parse a comma-separated env list; undefined input means "unset" → undefined. */
export function parseCommaList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items;
}

/** One row of the machine-readable services index (GET /api/x402/v1/services.json). */
export interface X402ServicesIndexEntry {
  id: X402ServiceId;
  family: X402ServiceFamily;
  method: X402ServiceDef["method"];
  path: string;
  priceUsd: string;
  auth: X402ServiceAuth;
  specRef: string;
}

/**
 * The free machine-readable services index, generated from X402_SERVICES —
 * never hand-duplicated: adding a catalog row adds it here for free.
 */
export function buildX402ServicesIndex(): X402ServicesIndexEntry[] {
  return X402_SERVICES.map((def) => ({
    id: def.id,
    family: def.family,
    method: def.method,
    path: def.path,
    priceUsd: def.priceUsd,
    auth: def.auth,
    specRef: def.specRef,
  }));
}
