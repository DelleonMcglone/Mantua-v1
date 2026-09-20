/**
 * Phase 17 — the OpenAPI registry: the seven hand-authored OpenAPI 3.1
 * documents (the marketplace listing prerequisite), loaded as static JSON —
 * no codegen, no new dependencies. The unpaid publication surface
 * (`routes/x402-openapi.ts`) serves these documents and the index built
 * here; nothing else may hand-construct service contract metadata.
 *
 * Every document is validated against the catalog at module load via the
 * shared parity comparator, so a spec that drifts from X402_SERVICES on
 * path, method, or price fails fast on boot instead of serving a stale
 * contract to the listing review. The CI parity test remains the merge gate
 * (red on induced drift); this load-time check is defense in depth.
 */
import type { X402ServiceDef, X402ServiceId } from "../catalog.ts";
import { X402_SERVICES, getX402ServiceDef } from "../catalog.ts";
import { findCatalogSpecDrift } from "./parity.ts";

import marketDiscovery from "./market-discovery.json";
import marketIntelligence from "./market-intelligence.json";
import tradingQuote from "./trading-quote.json";
import tradingCalldata from "./trading-calldata.json";
import portfolioExposure from "./portfolio-exposure.json";
import hedging from "./hedging.json";
import sportsIntelligence from "./sports-intelligence.json";

/** A validated OpenAPI 3.1 service document, as served. */
export interface X402OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
    "x-mantua-service-id": X402ServiceId;
    "x-mantua-price-usd": string;
  };
  paths: Record<string, unknown>;
}

/** One entry of the served document index (/api/x402/openapi.json). */
export interface X402OpenApiIndexEntry {
  id: X402ServiceId;
  method: X402ServiceDef["method"];
  path: string;
  priceUsd: string;
  auth: X402ServiceDef["auth"];
  summary: string;
  /** Where the full document is served (unpaid). */
  specRef: string;
}

export interface X402OpenApiIndex {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  services: X402OpenApiIndexEntry[];
}

/** The hand-authored documents, keyed by service id (build-time truth). */
const RAW_SPECS: Readonly<Record<X402ServiceId, unknown>> = {
  "market-discovery": marketDiscovery,
  "market-intelligence": marketIntelligence,
  "trading-quote": tradingQuote,
  "trading-calldata": tradingCalldata,
  "portfolio-exposure": portfolioExposure,
  hedging,
  "sports-intelligence": sportsIntelligence,
};

/** The listing review must find the 402 payment contract in the document. */
function assertPaymentDescription(id: X402ServiceId, doc: X402OpenApiDocument): void {
  const description = doc.info.description;
  if (description.length === 0 || !description.includes("PAYMENT-REQUIRED")) {
    throw new Error(
      `OpenAPI document for ${id} must describe the 402 PAYMENT-REQUIRED contract in info.description`,
    );
  }
}

/** Validate one document's shape and catalog parity; throw on any drift. */
function loadSpec(id: X402ServiceId, raw: unknown): X402OpenApiDocument {
  const def = getX402ServiceDef(id);
  if (!def) throw new Error(`No catalog row for OpenAPI document "${id}"`);
  const drift = findCatalogSpecDrift([def], { [id]: raw });
  if (drift.length > 0) {
    const detail = drift
      .map((f) => `${f.field}: catalog=${f.catalogValue ?? "—"} spec=${f.specValue ?? "—"}`)
      .join("; ");
    throw new Error(`OpenAPI document "${id}" drifted from the x402 catalog — ${detail}`);
  }
  const doc = raw as X402OpenApiDocument;
  assertPaymentDescription(id, doc);
  return doc;
}

const SPECS: Readonly<Record<X402ServiceId, X402OpenApiDocument>> = Object.fromEntries(
  (Object.keys(RAW_SPECS) as X402ServiceId[]).map((id) => [id, loadSpec(id, RAW_SPECS[id])]),
) as Readonly<Record<X402ServiceId, X402OpenApiDocument>>;

/** The validated OpenAPI document for a service, or undefined for unknown ids. */
export function getX402OpenApiSpec(id: string): X402OpenApiDocument | undefined {
  return SPECS[id as X402ServiceId];
}

/** The unpaid document index — one entry per catalog row, catalog-generated. */
export function buildX402OpenApiIndex(): X402OpenApiIndex {
  return {
    openapi: "3.1.0",
    info: {
      title: "Mantua x402 services",
      version: "1.0.0",
      description:
        "Per-service OpenAPI 3.1 documents for Mantua's paid x402 services. " +
        "Document fetches are unpaid — only the services themselves are paywalled.",
    },
    services: X402_SERVICES.map((def) => ({
      id: def.id,
      method: def.method,
      path: def.path,
      priceUsd: def.priceUsd,
      auth: def.auth,
      summary: def.summary,
      specRef: def.specRef,
    })),
  };
}
