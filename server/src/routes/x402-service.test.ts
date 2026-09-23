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
 *    `accepts[]` names scheme "exact", USDC on Base, payTo = the seller;
 *  - X402_SELLER_ADDRESS set but the facilitator is testnet-only (the default
 *    x402.org, the 2026-09-23 prod incident) → initialization is handled: a
 *    503 `X402_FACILITATOR_UNSUPPORTED`, and NO unhandled rejection.
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
const e = env as unknown as {
  X402_SELLER_ADDRESS: string | undefined;
  X402_FACILITATOR_URL: string | undefined;
};
const savedSeller = e.X402_SELLER_ADDRESS;
const savedFacilitator = e.X402_FACILITATOR_URL;
/** Stand-in for a facilitator that serves Base Mainnet. */
const MAINNET_FACILITATOR = "https://mainnet-facilitator.test";

const SELLER = "0x00000000000000000000000000000000DeaDBeef";
const BRIEF_PATH = "/api/x402/analyst-brief";
const BASE_NETWORK = "eip155:8453";

// The paywall syncs supported payment kinds from the facilitator when the
// module loads. Serve that handshake locally — x402.org as it really answers
// (testnets only: Base Sepolia), the stand-in mainnet facilitator with Base
// Mainnet — and pass every other request (our own requests to the ephemeral
// test server included) through to the real fetch.
const realFetch = globalThis.fetch;
const facilitatorHits: string[] = [];
globalThis.fetch = (input, init): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("x402.org") || url.startsWith(MAINNET_FACILITATOR)) {
    facilitatorHits.push(url);
    const network = url.includes("x402.org") ? "eip155:84532" : BASE_NETWORK;
    return Promise.resolve(
      Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network }],
        extensions: [],
        signers: {},
      }),
    );
  }
  return realFetch(input, init);
};

// The prod incident was an unhandled rejection from the paywall's eager
// facilitator handshake — record any, so the suite can assert there are none.
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};
process.on("unhandledRejection", onUnhandled);

const servers: Server[] = [];
after(() => {
  globalThis.fetch = realFetch;
  process.off("unhandledRejection", onUnhandled);
  e.X402_SELLER_ADDRESS = savedSeller;
  e.X402_FACILITATOR_URL = savedFacilitator;
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

type ServiceModule = typeof import("./x402-service.ts");

async function loadModule(tag: string): Promise<ServiceModule> {
  return (await import(`./x402-service.ts?case=${tag}`)) as ServiceModule;
}

async function loadRouter(tag: string): Promise<express.Router> {
  return (await loadModule(tag)).x402ServiceRouter;
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
    e.X402_FACILITATOR_URL = MAINNET_FACILITATOR;
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

  void it("stays 503 dark without an unhandled rejection when the facilitator is testnet-only", async () => {
    e.X402_SELLER_ADDRESS = SELLER;
    e.X402_FACILITATOR_URL = undefined; // default x402.org — Base Sepolia only
    const mod = await loadModule("testnet-only-facilitator");
    assert.ok(mod.analystBriefPaywall, "the seller is configured, so a paywall is built");
    // Initialization runs at module load and must settle, not throw.
    assert.equal(await mod.analystBriefPaywall.ready, "unsupported");

    const origin = await serve(mod.x402ServiceRouter);
    const res = await realFetch(`${origin}${BRIEF_PATH}`, {
      headers: { Accept: "application/json" },
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string; error?: string };
    assert.equal(body.code, "X402_FACILITATOR_UNSUPPORTED");
    assert.match(body.error ?? "", /X402_FACILITATOR_URL/);

    // Give any stray rejection a turn to surface.
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(unhandled, [], "initialization must never reject unhandled");
  });

  void it("initializes cleanly against a facilitator that serves Base Mainnet", async () => {
    e.X402_SELLER_ADDRESS = SELLER;
    e.X402_FACILITATOR_URL = MAINNET_FACILITATOR;
    const mod = await loadModule("mainnet-facilitator");
    assert.equal(await mod.analystBriefPaywall?.ready, "ready");
    assert.ok(
      facilitatorHits.some((u) => u.startsWith(MAINNET_FACILITATOR)),
      "the handshake goes to X402_FACILITATOR_URL",
    );
    assert.deepEqual(unhandled, []);
  });

  void it("keeps unrelated paths out of the paywall", async () => {
    e.X402_SELLER_ADDRESS = SELLER;
    const origin = await serve(await loadRouter("enabled-other-path"));
    const res = await realFetch(`${origin}/api/health-not-here`);
    assert.equal(res.status, 404, "the router only owns the brief path");
  });
});
