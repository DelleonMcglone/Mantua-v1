import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { FacilitatorClient } from "@x402/core/server";
import type { RequestHandler } from "express";
import type { X402ServiceDef } from "../lib/x402/catalog.ts";
import type { X402PaywallDeps } from "./x402-paywall.ts";

/**
 * D-106 — tests for the Phase 17 dual-rail paywall factory
 * (`server/src/middleware/x402-paywall.ts`). The whole chain runs hermetically:
 *
 *  - the facilitator's /supported handshake is answered by a fetch stub (the
 *    same trick as x402-service.test.ts), with a hit counter proving the
 *    graceful-dark gates never touch the network;
 *  - facilitator verify/settle are injectable spies, so a "paid" request is
 *    driven by crafting a PAYMENT-SIGNATURE header whose `accepted` row is
 *    lifted verbatim from the live 402 — no signer, no chain;
 *  - the sale audit is captured through the `auditSale` seam.
 *
 * Covered: the single 402 advertising BOTH rails (vanilla EIP-3009 and
 * Gateway batching) in one accepts array; the fail-closed dark gates
 * (X402_SELLER_ADDRESS, X402_SELLER_SERVICES, empty allowlist); the
 * pre-settlement allowlist 403 (an un-allowlisted payer is never charged —
 * zero facilitator verify/settle calls); and exactly one agent_x402_sale
 * audit row per settled payment.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { X402_SERVICES, getX402ServiceDef, findX402ServiceByPath, parseCommaList, x402PriceString } =
  await import("../lib/x402/catalog.ts");
const { x402ServiceChain, payerFromPaymentHeader } = await import("./x402-paywall.ts");
const express = (await import("express")).default;

const SELLER = "0x00000000000000000000000000000000DeaDBeef";
const PAYER = "0x1111111111111111111111111111111111111111";
const ALLOWED = "0x2222222222222222222222222222222222222222";
const UNALLOWED = "0x3333333333333333333333333333333333333333";

const QUOTE_DEF = getX402ServiceDef("trading-quote");
const SPORTS_DEF = getX402ServiceDef("sports-intelligence");
assert.ok(QUOTE_DEF, "catalog must define trading-quote");
assert.ok(SPORTS_DEF, "catalog must define sports-intelligence");

// The paywall syncs supported payment kinds from the facilitator on first
// use. Serve that handshake locally (any non-local URL); everything local
// (the ephemeral test server) goes to the real fetch.
const realFetch = globalThis.fetch;
let facilitatorHits = 0;
globalThis.fetch = (input, init): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    facilitatorHits++;
    return Promise.resolve(
      Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
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
  for (const s of servers) s.close();
});

/** Facilitator spy with call counters — `valid`/`settleOk` shape the flow. */
function spyFacilitator(opts: { valid?: boolean; settleOk?: boolean } = {}) {
  const calls = { verify: 0, settle: 0 };
  return {
    calls,
    verify: () => {
      calls.verify++;
      return Promise.resolve({ isValid: opts.valid ?? true, payer: PAYER });
    },
    settle: () => {
      calls.settle++;
      return Promise.resolve({
        success: opts.settleOk ?? true,
        transaction: "0xtxhash",
        network: "eip155:8453" as const,
        payer: PAYER,
      });
    },
    getSupported: () =>
      Promise.resolve({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" as const }],
        extensions: [],
        signers: {},
      }),
  };
}

type DepsOver = Partial<X402PaywallDeps> & { facilitator?: ReturnType<typeof spyFacilitator> };

function deps(over: DepsOver = {}): X402PaywallDeps {
  const { facilitator, ...rest } = over;
  return { sellerAddress: SELLER, vanillaFacilitator: facilitator ?? spyFacilitator(), ...rest };
}

/** Mount a paywalled service ahead of a stub handler; return its origin. */
async function serve(def: { path: string }, chain: RequestHandler[]): Promise<string> {
  const app = express();
  for (const method of ["get", "post"] as const) {
    app[method](def.path, ...chain, (_req, res) => {
      res.json({ ok: true });
    });
  }
  return await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

/** The base64 PAYMENT-SIGNATURE header for a payer accepting the 402's row. */
function paymentHeader(payer: string, accepted: unknown, resource?: unknown): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted,
      resource,
      authorization: { from: payer },
      signature: { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 },
    }),
  ).toString("base64");
}

interface Required402 {
  accepts?: {
    scheme: string;
    network: string;
    payTo: string;
    amount: string;
    maxTimeoutSeconds: number;
    extra?: { name?: string; version?: string };
  }[];
  resource?: unknown;
}

/**
 * Boot a paywalled service and return a fetcher whose `paid()` does the 402
 * dance: an unpaid request captures the PAYMENT-REQUIRED accepts row, then
 * the follow-up request presents a crafted payment header for `payer`.
 */
async function bootPaid(def: X402ServiceDef, depsOver: DepsOver) {
  const facilitator = depsOver.facilitator ?? spyFacilitator();
  const origin = await serve(def, x402ServiceChain(def, deps({ ...depsOver, facilitator })));
  return {
    facilitator,
    async paid(payer: string, body?: object): Promise<Response> {
      const unpaid = await realFetch(`${origin}${def.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      assert.equal(unpaid.status, 402, "prelude: unpaid request must draw the 402");
      const required = JSON.parse(
        Buffer.from(unpaid.headers.get("payment-required") ?? "", "base64").toString("utf8"),
      ) as Required402;
      const accepted = required.accepts?.[0];
      assert.ok(accepted, "prelude: 402 must advertise an accepts row");
      return realFetch(`${origin}${def.path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": paymentHeader(payer, accepted, required.resource),
        },
        body: JSON.stringify(body ?? {}),
      });
    },
  };
}

void describe("x402 service catalog (MP-004)", () => {
  void it("lists exactly the seven Phase 17 services with spec paths and prices", () => {
    assert.deepEqual(
      X402_SERVICES.map((s) => [s.id, s.method, s.path, s.priceUsd, s.auth]),
      [
        ["market-discovery", "GET", "/api/x402/v1/markets/discover", "0.001", "payment"],
        ["market-intelligence", "GET", "/api/x402/v1/intelligence/market", "0.01", "payment"],
        ["trading-quote", "POST", "/api/x402/v1/trading/quote", "0.005", "payment"],
        ["trading-calldata", "POST", "/api/x402/v1/trading/calldata", "0.02", "payment"],
        ["portfolio-exposure", "GET", "/api/x402/v1/portfolio/exposure", "0.005", "payment"],
        ["hedging", "GET", "/api/x402/v1/hedging/plan", "0.01", "payment"],
        ["sports-intelligence", "GET", "/api/x402/v1/sports/context", "0.01", "allowlist+payment"],
      ],
    );
    for (const s of X402_SERVICES) {
      assert.ok(s.summary.length > 0, `${s.id} needs a summary`);
      assert.match(s.specRef, /^\/api\/x402\/openapi\//, `${s.id} needs an OpenAPI specRef`);
    }
    assert.equal(x402PriceString(QUOTE_DEF), "$0.005");
  });

  void it("looks services up by id and by method+path", () => {
    assert.equal(getX402ServiceDef("hedging")?.path, "/api/x402/v1/hedging/plan");
    assert.equal(getX402ServiceDef("no-such-service"), undefined);
    assert.equal(
      findX402ServiceByPath("POST", "/api/x402/v1/trading/calldata")?.id,
      "trading-calldata",
    );
    assert.equal(findX402ServiceByPath("GET", "/api/x402/v1/trading/calldata"), undefined);
  });

  void it("parses comma lists; undefined stays undefined (unset ≠ empty)", () => {
    assert.equal(parseCommaList(undefined), undefined);
    assert.deepEqual(parseCommaList(""), []);
    assert.deepEqual(parseCommaList("a, b ,,c"), ["a", "b", "c"]);
  });
});

void describe("dual-rail paywall (MP-004)", () => {
  void it("answers an unpaid request with 402 + PAYMENT-REQUIRED offering BOTH rails", async () => {
    facilitatorHits = 0;
    const origin = await serve(
      QUOTE_DEF,
      x402ServiceChain(QUOTE_DEF, deps({ enabledServiceIds: ["trading-quote"] })),
    );
    const res = await realFetch(`${origin}${QUOTE_DEF.path}`, { method: "POST" });
    assert.equal(res.status, 402, "payment IS the auth — unpaid requests get 402");
    const header = res.headers.get("payment-required");
    assert.ok(header, "402 must carry the PAYMENT-REQUIRED header");
    const required = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Required402;
    assert.equal(required.accepts?.length, 2, "one 402, two rails");

    const [vanilla, gateway] = required.accepts ?? [];
    // Vanilla EIP-3009 rail: USDC domain, one second above the Gateway auth
    // window so core's accepted-requirements matching stays unambiguous.
    assert.equal(vanilla.scheme, "exact");
    assert.equal(vanilla.network, "eip155:8453");
    assert.equal(vanilla.payTo.toLowerCase(), SELLER.toLowerCase());
    assert.equal(vanilla.amount, "5000", "$0.005 in USDC atomic units (6dp)");
    assert.deepEqual(vanilla.extra, { name: "USD Coin", version: "2" });
    assert.equal(vanilla.maxTimeoutSeconds, 604901);
    // Circle Gateway batching rail.
    assert.equal(gateway.scheme, "exact");
    assert.equal(gateway.network, "eip155:8453");
    assert.equal(gateway.amount, "5000");
    assert.equal(gateway.extra?.name, "GatewayWalletBatched");
    assert.equal(gateway.maxTimeoutSeconds, 604900);
    assert.equal(facilitatorHits, 1, "only the supported-kind sync touches the facilitator");
  });

  void it("stays dark (503) when X402_SELLER_ADDRESS is unset", async () => {
    facilitatorHits = 0;
    const fac = spyFacilitator();
    const origin = await serve(
      QUOTE_DEF,
      x402ServiceChain(QUOTE_DEF, {
        enabledServiceIds: ["trading-quote"],
        vanillaFacilitator: fac,
      }),
    );
    const res = await realFetch(`${origin}${QUOTE_DEF.path}`, { method: "POST" });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "X402_SERVICE_DISABLED");
    assert.equal(fac.calls.verify, 0, "dark service must not verify");
    assert.equal(fac.calls.settle, 0, "dark service must not settle");
    assert.equal(facilitatorHits, 0, "graceful-dark must not touch the facilitator");
  });

  void it("stays dark (503) when X402_SELLER_SERVICES is absent", async () => {
    const fac = spyFacilitator();
    const origin = await serve(
      QUOTE_DEF,
      x402ServiceChain(QUOTE_DEF, { sellerAddress: SELLER, vanillaFacilitator: fac }),
    );
    const res = await realFetch(`${origin}${QUOTE_DEF.path}`, { method: "POST" });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code?: string }).code, "X402_SERVICE_DISABLED");
    assert.equal(fac.calls.verify, 0);
  });

  void it("stays dark (503) for a service not listed in X402_SELLER_SERVICES", async () => {
    const fac = spyFacilitator();
    const origin = await serve(
      SPORTS_DEF,
      x402ServiceChain(
        SPORTS_DEF,
        deps({
          enabledServiceIds: ["trading-quote"],
          payerAllowlist: [ALLOWED],
          facilitator: fac,
        }),
      ),
    );
    const res = await realFetch(`${origin}${SPORTS_DEF.path}`, { method: "GET" });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code?: string }).code, "X402_SERVICE_DISABLED");
    assert.equal(fac.calls.verify, 0);
  });

  void it("keeps an allowlist+payment service dark while its allowlist is empty", async () => {
    const fac = spyFacilitator();
    const origin = await serve(
      SPORTS_DEF,
      x402ServiceChain(
        SPORTS_DEF,
        deps({
          enabledServiceIds: ["sports-intelligence"],
          payerAllowlist: [],
          facilitator: fac,
        }),
      ),
    );
    const res = await realFetch(`${origin}${SPORTS_DEF.path}`, { method: "GET" });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code?: string }).code, "X402_SERVICE_DISABLED");
  });

  void it("403s an un-allowlisted payer BEFORE any settlement — never charged", async () => {
    const fac = spyFacilitator();
    const t = await bootPaid(SPORTS_DEF, {
      enabledServiceIds: ["sports-intelligence"],
      payerAllowlist: [ALLOWED],
      facilitator: fac,
    });
    // The 402 prelude proves the gate passes UNPAID requests through; the
    // paid request from an un-allowlisted payer is refused pre-settlement.
    const res = await t.paid(UNALLOWED);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "x402_payer_not_authorized");
    assert.equal(fac.calls.verify, 0, "refusal must happen before any facilitator verify");
    assert.equal(fac.calls.settle, 0, "refusal must happen before any settlement");
  });

  void it("403s a payment payload that cannot prove its payer (fail-closed)", async () => {
    const fac = spyFacilitator();
    const origin = await serve(
      SPORTS_DEF,
      x402ServiceChain(
        SPORTS_DEF,
        deps({
          enabledServiceIds: ["sports-intelligence"],
          payerAllowlist: [ALLOWED],
          facilitator: fac,
        }),
      ),
    );
    for (const header of ["not base64 !!", Buffer.from(JSON.stringify({})).toString("base64")]) {
      const res = await realFetch(`${origin}${SPORTS_DEF.path}`, {
        method: "GET",
        headers: { "payment-signature": header },
      });
      assert.equal(res.status, 403, `unprovable payload must be refused: ${header}`);
      assert.equal(((await res.json()) as { code?: string }).code, "x402_payer_not_authorized");
    }
    assert.equal(fac.calls.verify, 0);
    assert.equal(fac.calls.settle, 0);
  });

  void it("serves an allowlisted payer through the full paid flow", async () => {
    const fac = spyFacilitator();
    const t = await bootPaid(SPORTS_DEF, {
      enabledServiceIds: ["sports-intelligence"],
      payerAllowlist: [ALLOWED],
      facilitator: fac,
    });
    const res = await t.paid(ALLOWED);
    assert.equal(res.status, 200, "an allowlisted payer is served");
    const body = (await res.json()) as { ok?: boolean };
    assert.equal(body.ok, true);
    assert.equal(fac.calls.verify, 1);
    assert.equal(fac.calls.settle, 1);
  });

  void it("writes exactly one agent_x402_sale audit row per settled payment", async () => {
    const auditEntries: unknown[] = [];
    const t = await bootPaid(QUOTE_DEF, {
      enabledServiceIds: ["trading-quote"],
      auditSale: (entry) => {
        auditEntries.push(entry);
        return Promise.resolve();
      },
    });
    const res = await t.paid(PAYER);
    assert.equal(res.status, 200);
    assert.ok(
      (res.headers.get("payment-response") ?? "").length > 0,
      "the settled payment lands in PAYMENT-RESPONSE",
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(auditEntries.length, 1, "exactly one audit row per settled payment");
    const entry = auditEntries[0] as {
      walletAddress?: string;
      params: { serviceId?: string; priceUsd?: string; network?: string };
      txHash?: string;
    };
    assert.equal(entry.walletAddress?.toLowerCase(), PAYER.toLowerCase());
    assert.equal(entry.params.serviceId, "trading-quote");
    assert.equal(entry.params.priceUsd, "0.005");
    assert.equal(entry.params.network, "eip155:8453");
    assert.equal(entry.txHash, "0xtxhash");
  });

  void it("audits nothing when settlement fails", async () => {
    const auditEntries: unknown[] = [];
    const t = await bootPaid(QUOTE_DEF, {
      enabledServiceIds: ["trading-quote"],
      facilitator: spyFacilitator({ settleOk: false }),
      auditSale: (entry) => {
        auditEntries.push(entry);
        return Promise.resolve();
      },
    });
    await t.paid(PAYER);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(auditEntries.length, 0, "a failed settlement is not a sale");
  });

  void it("audits nothing for an unpaid (402) request", async () => {
    const auditEntries: unknown[] = [];
    const origin = await serve(
      QUOTE_DEF,
      x402ServiceChain(
        QUOTE_DEF,
        deps({
          enabledServiceIds: ["trading-quote"],
          auditSale: (entry) => {
            auditEntries.push(entry);
            return Promise.resolve();
          },
        }),
      ),
    );
    const res = await realFetch(`${origin}${QUOTE_DEF.path}`, { method: "POST" });
    assert.equal(res.status, 402);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(auditEntries.length, 0);
  });

  void it("reads the payer from the PAYMENT-SIGNATURE header", () => {
    const req = {
      get: (name: string) =>
        name === "payment-signature" ? paymentHeader(UNALLOWED, {}) : undefined,
    };
    assert.equal(payerFromPaymentHeader(req as never), UNALLOWED);
    const absent = { get: () => undefined };
    assert.equal(payerFromPaymentHeader(absent as never), null);
    const garbage = { get: () => "!!!" };
    assert.equal(payerFromPaymentHeader(garbage as never), null);
  });

  void it("responds instead of crashing when the facilitator is unreachable", async () => {
    const broken = {
      verify: () => Promise.reject(new Error("boom")),
      settle: () => Promise.reject(new Error("boom")),
      getSupported: () => Promise.reject(new Error("boom")),
    } as unknown as FacilitatorClient;
    const origin = await serve(
      QUOTE_DEF,
      x402ServiceChain(QUOTE_DEF, {
        enabledServiceIds: ["trading-quote"],
        vanillaFacilitator: broken,
      }),
    );
    const res = await realFetch(`${origin}${QUOTE_DEF.path}`, { method: "POST" });
    assert.ok([200, 402, 503].includes(res.status), "the chain responds, it does not crash");
  });
});
