import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

/**
 * Phase 17 — the OpenAPI publication tests: the CI parity gate behind the
 * marketplace listing prerequisite, plus the unpaid-serving contract.
 *
 * Covered: catalog↔spec parity is GREEN on match (every catalog row has a
 * served spec and vice versa, with identical path/method/price) and RED on
 * induced drift in either direction (price, path, method, missing spec,
 * orphan spec); the per-service documents, document index, and services
 * index fetch UNPAID with 200 + application/json while the services
 * themselves stay paywalled; unknown service ids 404; services.json is
 * generated from the catalog, never hand-duplicated.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const express = (await import("express")).default;
const { X402_SERVICES, buildX402ServicesIndex } = await import("../lib/x402/catalog.ts");
const { getX402OpenApiSpec } = await import("../lib/x402/openapi/registry.ts");
const { findCatalogSpecDrift, parseSpecTarget } = await import("../lib/x402/openapi/parity.ts");
const { x402OpenApiRouter } = await import("./x402-openapi.ts");

/** The validated registry as a plain id→document record for the parity gate. */
const servedSpecs: Record<string, unknown> = Object.fromEntries(
  X402_SERVICES.map((def) => [def.id, getX402OpenApiSpec(def.id)]),
);

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

const server = express().use(x402OpenApiRouter).listen(0);
servers.push(server);
const address = server.address();
assert.ok(address !== null && typeof address === "object", "test server must be listening");
const base = `http://127.0.0.1:${String(address.port)}`;

async function get(path: string): Promise<Response> {
  return fetch(`${base}${path}`);
}

describe("x402 catalog↔spec parity gate", () => {
  it("is green on match — every catalog row has a served spec and vice versa", () => {
    assert.deepEqual(findCatalogSpecDrift(X402_SERVICES, servedSpecs), []);
  });

  it("flags a price drift between the catalog and the served spec", () => {
    const drifted = X402_SERVICES.map((def, i) => (i === 0 ? { ...def, priceUsd: "9.99" } : def));
    const findings = findCatalogSpecDrift(drifted, servedSpecs);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].serviceId, "market-discovery");
    assert.equal(findings[0].field, "priceUsd");
    assert.equal(findings[0].catalogValue, "9.99");
  });

  it("flags a path drift between the catalog and the served spec", () => {
    const drifted = X402_SERVICES.map((def, i) =>
      i === 0 ? { ...def, path: "/api/x402/v1/markets/renamed" } : def,
    );
    const findings = findCatalogSpecDrift(drifted, servedSpecs);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].field, "path");
  });

  it("flags a method drift between the catalog and the served spec", () => {
    const drifted = X402_SERVICES.map((def, i) =>
      i === 0 ? { ...def, method: "POST" as const } : def,
    );
    const findings = findCatalogSpecDrift(drifted, servedSpecs);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].field, "method");
  });

  it("flags a catalog row with no served spec", () => {
    const missing = X402_SERVICES[0];
    assert.ok(missing, "the catalog must not be empty");
    const findings = findCatalogSpecDrift([missing], {});
    assert.equal(findings.length, 1);
    assert.equal(findings[0].field, "spec");
    assert.equal(findings[0].specValue, "missing");
  });

  it("flags a spec with no catalog row", () => {
    const removed = X402_SERVICES[0];
    assert.ok(removed, "the catalog must not be empty");
    const cloned = structuredClone(servedSpecs);
    const { [removed.id]: removedSpec, ...rest } = cloned;
    const orphan: Record<string, unknown> = { ...rest, "rogue-service": removedSpec };
    const findings = findCatalogSpecDrift(
      X402_SERVICES.filter((d) => d.id !== removed.id),
      orphan,
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].serviceId, "rogue-service");
    assert.equal(findings[0].specValue, "no catalog row");
  });

  it("treats a document without the x-mantua metadata as unparseable", () => {
    assert.equal(parseSpecTarget({ openapi: "3.1.0", info: {}, paths: {} }), undefined);
  });
});

describe("unpaid OpenAPI publication", () => {
  it("serves every catalog row's spec unpaid with application/json", async () => {
    for (const def of X402_SERVICES) {
      const res = await get(def.specRef);
      assert.equal(res.status, 200, def.specRef);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/);
      const doc = (await res.json()) as {
        openapi: string;
        info: Record<string, unknown>;
        paths: Record<string, unknown>;
      };
      assert.ok(doc.openapi.startsWith("3.1."), def.specRef);
      assert.equal(doc.info["x-mantua-service-id"], def.id);
      assert.equal(doc.info["x-mantua-price-usd"], def.priceUsd);
      assert.ok(
        String(doc.info.description).includes("PAYMENT-REQUIRED"),
        `${def.specRef} must describe the 402 payment contract`,
      );
      assert.equal(Object.keys(doc.paths).length, 1);
    }
  });

  it("404s an unknown service id", async () => {
    const res = await get("/api/x402/openapi/no-such-service.json");
    assert.equal(res.status, 404);
  });

  it("serves the document index unpaid, one entry per catalog row", async () => {
    const res = await get("/api/x402/openapi.json");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const index = (await res.json()) as { services: Array<{ id: string; specRef: string }> };
    assert.equal(index.services.length, X402_SERVICES.length);
    for (const def of X402_SERVICES) {
      assert.ok(
        index.services.some((s) => s.id === def.id && s.specRef === def.specRef),
        `index missing ${def.id}`,
      );
    }
  });

  it("serves the machine-readable services index unpaid, generated from the catalog", async () => {
    const res = await get("/api/x402/v1/services.json");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = (await res.json()) as { services: unknown };
    // Generated, never hand-duplicated: identical to the catalog projection.
    assert.deepEqual(body.services, buildX402ServicesIndex());
    const trading = (body.services as Array<{ id: string; family: string }>).find(
      (s) => s.id === "trading-quote",
    );
    assert.equal(trading?.family, "trading");
  });
});
