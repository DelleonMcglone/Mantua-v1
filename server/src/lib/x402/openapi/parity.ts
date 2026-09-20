/**
 * Phase 17 — the catalog↔spec parity checker: the CI gate behind the
 * marketplace listing prerequisite. Circle's listing review fetches the
 * published OpenAPI documents; if a catalog row and its served spec drift
 * apart (path, method, price, or a missing/extra document), the listing
 * rots silently. This module is the single comparison both consumers share:
 *
 *  - the OpenAPI registry (`openapi/registry.ts`) runs it at module load so
 *    a drifted document fails fast on boot, and
 *  - the CI test (`routes/x402-openapi.test.ts`) runs it red-on-drift /
 *    green-on-match so the drift can never merge.
 *
 * Pure function — catalog and specs are injected, so tests can induce drift
 * without touching real modules.
 */
import type { X402ServiceDef } from "../catalog.ts";

/** One catalog↔spec disagreement, in both directions. */
export interface X402SpecParityFinding {
  serviceId: string;
  /** What drifted: a missing/unparseable document, or one field of it. */
  field: "spec" | "serviceId" | "path" | "method" | "priceUsd";
  catalogValue: string | null;
  specValue: string | null;
}

/** The contract-carrying parts of an OpenAPI document, extracted. */
interface SpecTarget {
  serviceId: string;
  path: string;
  method: string;
  priceUsd: string;
}

/** HTTP methods a spec path may declare (lowercase, as OpenAPI spells them). */
const SPEC_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/**
 * Extract the single operation's contract fields from a loaded JSON
 * document. Returns undefined when the document is not a well-formed
 * single-operation OpenAPI 3.1 document — the parity checker treats that as
 * a "spec" finding rather than guessing fields.
 */
export function parseSpecTarget(raw: unknown): SpecTarget | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const doc = raw as Record<string, unknown>;
  if (typeof doc.openapi !== "string" || !doc.openapi.startsWith("3.1")) return undefined;

  const info = doc.info;
  if (typeof info !== "object" || info === null) return undefined;
  const infoRec = info as Record<string, unknown>;
  const serviceId = infoRec["x-mantua-service-id"];
  const priceUsd = infoRec["x-mantua-price-usd"];
  if (typeof serviceId !== "string" || typeof priceUsd !== "string") return undefined;

  const paths = doc.paths as Record<string, unknown> | null;
  if (paths === null || typeof paths !== "object") return undefined;
  const pathKeys = Object.keys(paths);
  // Exactly one path (the service) with exactly one operation on it.
  if (pathKeys.length !== 1) return undefined;
  const path = pathKeys.at(0);
  if (path === undefined) return undefined;
  const operations = paths[path] as Record<string, unknown> | null;
  if (operations === null || typeof operations !== "object") return undefined;
  const method = Object.keys(operations).find((m) => SPEC_METHODS.has(m));
  if (method === undefined) return undefined;

  return { serviceId, path, method: method.toUpperCase(), priceUsd };
}

/**
 * Compare every catalog row against its served spec and vice versa. Empty
 * array = parity. Both directions are checked: a catalog row without a spec
 * breaks the listing prerequisite, and a spec without a catalog row is a
 * document nothing pays for.
 */
export function findCatalogSpecDrift(
  catalog: readonly X402ServiceDef[],
  specs: Readonly<Record<string, unknown>>,
): X402SpecParityFinding[] {
  const findings: X402SpecParityFinding[] = [];

  for (const def of catalog) {
    const raw = specs[def.id];
    const parsed = raw === undefined ? undefined : parseSpecTarget(raw);
    if (parsed === undefined) {
      findings.push({
        serviceId: def.id,
        field: "spec",
        catalogValue: `${def.method} ${def.path} @ ${def.priceUsd}`,
        specValue: raw === undefined ? "missing" : "unparseable",
      });
      continue;
    }
    if (parsed.serviceId !== def.id) {
      findings.push({
        serviceId: def.id,
        field: "serviceId",
        catalogValue: def.id,
        specValue: parsed.serviceId,
      });
    }
    if (parsed.path !== def.path) {
      findings.push({
        serviceId: def.id,
        field: "path",
        catalogValue: def.path,
        specValue: parsed.path,
      });
    }
    if (parsed.method !== def.method) {
      findings.push({
        serviceId: def.id,
        field: "method",
        catalogValue: def.method,
        specValue: parsed.method,
      });
    }
    if (parsed.priceUsd !== def.priceUsd) {
      findings.push({
        serviceId: def.id,
        field: "priceUsd",
        catalogValue: def.priceUsd,
        specValue: parsed.priceUsd,
      });
    }
  }

  for (const specId of Object.keys(specs)) {
    if (!catalog.some((def) => def.id === specId)) {
      findings.push({
        serviceId: specId,
        field: "spec",
        catalogValue: null,
        specValue: "no catalog row",
      });
    }
  }

  return findings;
}
