import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createX402SportsRouter, type X402SportsDeps } from "./x402-sports.ts";

/**
 * Phase 17 (MP-011) — tests for the PAID sports-intelligence service on
 * /api/x402/v1/sports/context (`server/src/routes/x402-sports.ts`), on the
 * house ephemeral-app + factory-overrides pattern (x402-trading.test.ts).
 * The paywall in front of the route is real; the facilitator behind it is a
 * spy, and "paid" requests craft a PAYMENT-SIGNATURE header whose `accepted`
 * row is lifted from the live 402 — so the full gate → paywall → settle →
 * audit flow runs without a signer or a chain.
 *
 * Covered: unpaid → 402 with BOTH rails advertised; paid (allowlisted
 * payer) → 200 via stubbed settlement; service absent from
 * X402_SELLER_SERVICES → 503 dark; empty X402_SPORTS_INTEL_ALLOWLIST →
 * dark; un-allowlisted payer → 403 x402_payer_not_authorized BEFORE any
 * facilitator call; the honesty contract (unavailable / not_found /
 * ambiguous + didYouMean) passes through verbatim.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const express = (await import("express")).default;

const SELLER = "0x00000000000000000000000000000000DeaDBeef";
const PAYER = "0x1111111111111111111111111111111111111111"; // allowlisted
const STRANGER = "0x2222222222222222222222222222222222222222"; // not allowlisted
const PATH = "/api/x402/v1/sports/context";

// The paywall syncs supported payment kinds from the facilitator on first
// use; answer that handshake locally (any non-local URL) and pass the
// ephemeral test server through to the real fetch.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
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

interface ToolCalls {
  game: { team: string; league?: string }[];
  live: { providerEventId?: string; team?: string }[];
  market: { providerEventId: string }[];
}

interface Harness {
  calls: ToolCalls;
  facilitator: { calls: { verify: number; settle: number } };
  paid(query: string, payer?: string): Promise<Response>;
}

/**
 * Boot the sports router with injected seams. Defaults: the game tool
 * resolves a game with providerEventId "12345", live/market resolve plain
 * ok records, the paywall's facilitator auto-verifies and auto-settles,
 * and PAYER is the one allowlisted payer.
 */
async function boot(
  over: Partial<X402SportsDeps> & {
    allowlist?: string[];
    /** Override the enabled service ids (default: sports-intelligence on). */
    enabledServiceIds?: string[];
    toolsError?: Error;
  } = {},
): Promise<Harness> {
  const calls: ToolCalls = { game: [], live: [], market: [] };
  const verifyCalls = { count: 0 };
  const settleCalls = { count: 0 };
  const fail = over.toolsError;
  const facilitator = {
    calls: {
      get verify() {
        return verifyCalls.count;
      },
      get settle() {
        return settleCalls.count;
      },
    },
    verify: () => {
      verifyCalls.count++;
      return Promise.resolve({ isValid: true, payer: PAYER });
    },
    settle: () => {
      settleCalls.count++;
      return Promise.resolve({
        success: true,
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
  const deps: X402SportsDeps = {
    game: (input) => {
      calls.game.push(input);
      if (fail) throw fail;
      return Promise.resolve({ status: "ok", providerEventId: "12345" });
    },
    live: (input) => {
      calls.live.push(input);
      if (fail) throw fail;
      return Promise.resolve({ status: "ok", state: "pregame" });
    },
    market: (input) => {
      calls.market.push(input);
      if (fail) throw fail;
      return Promise.resolve({ status: "ok", priceBps: 5200 });
    },
    paywall: {
      sellerAddress: SELLER,
      enabledServiceIds: over.enabledServiceIds ?? ["sports-intelligence"],
      payerAllowlist: over.allowlist ?? [PAYER],
      auditSale: async () => {}, // hermetic — no DB in unit tests
      vanillaFacilitator: facilitator,
    },
    ...over,
  };
  const app = express();
  app.use(express.json());
  app.use(createX402SportsRouter(deps));
  await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve(server);
    });
  });
  const addr = (servers[servers.length - 1].address() as { port: number }).port;
  const origin = `http://127.0.0.1:${String(addr)}`;

  async function paid(query: string, payer = PAYER): Promise<Response> {
    // The 402 dance: an unpaid request captures the PAYMENT-REQUIRED accepts
    // row; the follow-up presents a crafted payment header for `payer`.
    const unpaid = await realFetch(`${origin}${PATH}${query}`);
    assert.equal(unpaid.status, 402, `prelude: ${PATH} must 402 an unpaid request`);
    const required = JSON.parse(
      Buffer.from(unpaid.headers.get("payment-required") ?? "", "base64").toString("utf8"),
    ) as { accepts?: unknown[]; resource?: unknown };
    const accepted = required.accepts?.[0];
    assert.ok(accepted, "prelude: 402 must advertise an accepts row");
    const payment = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted,
        resource: required.resource,
        authorization: { from: payer },
        signature: { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 },
      }),
    ).toString("base64");
    return realFetch(`${origin}${PATH}${query}`, {
      headers: { "payment-signature": payment },
    });
  }

  return { calls, facilitator, paid };
}

void describe("paid sports-intelligence service (MP-011)", () => {
  void it("402s an unpaid request with BOTH rails in accepts", async () => {
    await boot();
    const origin = `http://127.0.0.1:${String(
      (servers[servers.length - 1].address() as { port: number }).port,
    )}`;
    const res = await realFetch(`${origin}${PATH}?team=Chiefs`);
    assert.equal(res.status, 402, "payment IS the auth — unpaid requests get 402");
    const required = JSON.parse(
      Buffer.from(res.headers.get("payment-required") ?? "", "base64").toString("utf8"),
    ) as { accepts?: { extra?: { name?: string } }[] };
    assert.equal(required.accepts?.length, 2, "one 402, two rails");
    assert.deepEqual(required.accepts[0].extra, { name: "USD Coin", version: "2" });
    assert.equal(required.accepts[1].extra?.name, "GatewayWalletBatched");
  });

  void it("200s a paid allowlisted request via stubbed settlement", async () => {
    const h = await boot();
    const res = await h.paid("?team=Chiefs");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      team?: string;
      game?: { status?: string; providerEventId?: string };
      live?: { state?: string };
    };
    assert.equal(body.team, "Chiefs");
    assert.equal(body.game?.status, "ok");
    assert.equal(body.game.providerEventId, "12345");
    assert.equal(body.live?.state, "pregame", "the resolved event enriches with live state");
    assert.ok(h.facilitator.calls.verify >= 1, "the paywall verified the payment");
    assert.equal(h.facilitator.calls.settle, 1, "exactly one settlement");
    assert.equal(h.calls.game.length, 1);
  });

  void it("serves live + market for a providerEventId query", async () => {
    const h = await boot();
    const res = await h.paid("?providerEventId=12345");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      providerEventId?: string;
      live?: { status?: string };
      market?: { priceBps?: number };
    };
    assert.equal(body.providerEventId, "12345");
    assert.equal(body.live?.status, "ok");
    assert.equal(body.market?.priceBps, 5200);
    assert.equal(h.calls.game.length, 0, "no game lookup on an event-id query");
    assert.deepEqual(h.calls.market, [{ providerEventId: "12345" }]);
  });

  void it("503s dark when the service is absent from X402_SELLER_SERVICES", async () => {
    const h = await boot({
      enabledServiceIds: ["trading-quote"], // sports-intelligence not enabled
    });
    const origin = `http://127.0.0.1:${String(
      (servers[servers.length - 1].address() as { port: number }).port,
    )}`;
    const res = await realFetch(`${origin}${PATH}?team=Chiefs`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "X402_SERVICE_DISABLED");
    assert.equal(h.facilitator.calls.settle, 0, "dark services never touch the facilitator");
    assert.equal(h.calls.game.length, 0);
  });

  void it("503s dark when the allowlist is empty (fail-closed default)", async () => {
    const h = await boot({ allowlist: [] });
    const origin = `http://127.0.0.1:${String(
      (servers[servers.length - 1].address() as { port: number }).port,
    )}`;
    const res = await realFetch(`${origin}${PATH}?team=Chiefs`);
    assert.equal(res.status, 503, "an empty allowlist leaves the service dark");
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "X402_SERVICE_DISABLED");
    assert.equal(h.calls.game.length, 0);
  });

  void it("403s an un-allowlisted payer BEFORE any facilitator call", async () => {
    const h = await boot();
    const res = await h.paid("?team=Chiefs", STRANGER);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "x402_payer_not_authorized");
    assert.equal(h.facilitator.calls.verify, 0, "no verify — refused pre-settlement");
    assert.equal(h.facilitator.calls.settle, 0, "the stranger is never charged");
    assert.equal(h.calls.game.length, 0, "the tools never ran");
  });

  void it("preserves the honesty contract verbatim — unavailable, not_found, ambiguous", async () => {
    const unavailable = await boot({
      game: () => Promise.resolve({ status: "unavailable", reason: "no events ingested yet" }),
    });
    const r1 = await unavailable.paid("?team=Chiefs");
    assert.equal(r1.status, 200, "an honest status IS the answer the caller paid for");
    const b1 = (await r1.json()) as {
      game?: { status?: string; reason?: string };
      live?: { state?: string };
    };
    assert.equal(b1.game?.status, "unavailable");
    assert.equal(b1.game.reason, "no events ingested yet");
    assert.equal(b1.live, undefined, "no event id → no live enrichment");

    const notFound = await boot({
      game: () => Promise.resolve({ status: "not_found", note: "No games recorded for Chiefs." }),
    });
    const r2 = await notFound.paid("?team=Chiefs");
    const b2 = (await r2.json()) as { game?: { status?: string } };
    assert.equal(b2.game?.status, "not_found");

    const ambiguous = await boot({
      game: () =>
        Promise.resolve({
          status: "ambiguous",
          didYouMean: [{ name: "Kansas City Chiefs", key: "kc", league: "nfl" }],
        }),
    });
    const r3 = await ambiguous.paid("?team=Chiefs");
    const b3 = (await r3.json()) as {
      game?: { status?: string; didYouMean?: { name: string }[] };
    };
    assert.equal(b3.game?.status, "ambiguous");
    assert.deepEqual(b3.game.didYouMean, [
      { name: "Kansas City Chiefs", key: "kc", league: "nfl" },
    ]);
  });

  void it("503s when the sports tools throw unexpectedly", async () => {
    const h = await boot({ toolsError: new Error("db down") });
    const res = await h.paid("?team=Chiefs");
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "UNAVAILABLE");
  });

  void it("400s a request with neither team nor providerEventId", async () => {
    const h = await boot();
    const res = await h.paid("");
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "BAD_REQUEST");
    assert.equal(h.calls.game.length, 0);
  });
});
