import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

/**
 * C-007 / D-106 — tests for the shipped x402 SELLER surface
 * (`GET /api/x402/analyst-brief`). D-106 flagged the shipped surfaces as
 * untested; this file covers the seller's two configuration states:
 *
 *  - X402_SELLER_ADDRESS unset → 503 `X402_SELLER_DISABLED` (the graceful-dark
 *    pattern), with no paywall and no facilitator traffic;
 *  - X402_SELLER_ADDRESS set → the @x402/express payment middleware is wired:
 *    an unpaid request draws HTTP 402 with a PAYMENT-REQUIRED header whose
 *    `accepts[]` names scheme "exact", USDC on Base, payTo = the seller.
 *
 * The router captures env.X402_SELLER_ADDRESS at module-eval time, so each
 * state gets a fresh module instance via a query-string import (Node treats a
 * different URL as a new module; the shared `env` object is mutated between
 * loads). The facilitator's /supported endpoint is answered locally by a
 * fetch stub so the suite is hermetic.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { env } = await import("../env.ts");
const e = env as unknown as { X402_SELLER_ADDRESS: string | undefined };
const savedSeller = e.X402_SELLER_ADDRESS;

const SELLER = "0x00000000000000000000000000000000DeaDBeef";
const BRIEF_PATH = "/api/x402/analyst-brief";
const BASE_NETWORK = "eip155:8453";

// The paywall middleware syncs supported payment kinds from the public
// facilitator (x402.org) when the module loads / on first paywalled request.
// Serve that handshake locally; pass every other request (our own requests to
// the ephemeral test server included) through to the real fetch.
const realFetch = globalThis.fetch;
const facilitatorHits: string[] = [];
globalThis.fetch = (input, init): Promise<Response> => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("x402.org")) {
    facilitatorHits.push(url);
    return Promise.resolve(
      Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: BASE_NETWORK }],
        extensions: [],
        signers: {},
      }),
    );
  }
  return realFetch(input, init);
};

const servers: Server[] = [];
after(() => {
  globalThis.fetch = realFetch;
  e.X402_SELLER_ADDRESS = savedSeller;
  for (const s of servers) s.close();
});

/** Mount a router instance on an ephemeral-port express app; return its origin. */
function serve(router: express.Router): Promise<string> {
  const app = express();
  app.use(router);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

async function loadRouter(tag: string): Promise<express.Router> {
  const mod = (await import(`./x402-service.ts?case=${tag}`)) as {
    x402ServiceRouter: express.Router;
  };
  return mod.x402ServiceRouter;
}

void describe("x402 seller — /api/x402/analyst-brief", () => {
  void it("reports 503 X402_SELLER_DISABLED when no seller address is configured", async () => {
    e.X402_SELLER_ADDRESS = undefined;
    const origin = await serve(await loadRouter("disabled"));
    const res = await realFetch(`${origin}${BRIEF_PATH}`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string; error?: string };
    assert.equal(body.code, "X402_SELLER_DISABLED");
    assert.match(body.error ?? "", /X402_SELLER_ADDRESS unset/);
    assert.equal(facilitatorHits.length, 0, "graceful-dark must not touch the facilitator");
  });

  void it("paywalls an unpaid request with 402 + PAYMENT-REQUIRED when the seller is set", async () => {
    e.X402_SELLER_ADDRESS = SELLER;
    const origin = await serve(await loadRouter("enabled"));
    const res = await realFetch(`${origin}${BRIEF_PATH}`, {
      headers: { Accept: "application/json" },
    });
    assert.equal(res.status, 402, "payment IS the auth — unpaid requests get 402");

    const header = res.headers.get("payment-required");
    assert.ok(header, "402 must carry the PAYMENT-REQUIRED header");
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      accepts?: {
        scheme?: string;
        network?: string;
        payTo?: string;
        amount?: string;
        maxAmountRequired?: string;
      }[];
    };
    const accept = decoded.accepts?.[0];
    assert.ok(accept, "accepts[] must not be empty");
    assert.equal(accept.scheme, "exact");
    assert.equal(accept.network, BASE_NETWORK);
    assert.equal(accept.payTo?.toLowerCase(), SELLER.toLowerCase());
    // $0.01 USDC in atomic units (6 decimals).
    assert.equal(accept.amount ?? accept.maxAmountRequired, "10000");
  });

  void it("keeps unrelated paths out of the paywall", async () => {
    e.X402_SELLER_ADDRESS = SELLER;
    const origin = await serve(await loadRouter("enabled-other-path"));
    const res = await realFetch(`${origin}/api/health-not-here`);
    assert.equal(res.status, 404, "the router only owns the brief path");
  });
});
