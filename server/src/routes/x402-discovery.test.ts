import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import {
  createX402DiscoveryRouter,
  type DiscoverReadWithUnavailable,
  type X402DiscoveryDeps,
} from "./x402-discovery.ts";
import type { DiscoverMarketWire } from "../lib/sports/market-discover.ts";

/**
 * Phase 17 (MP-005) — tests for the PAID market-discovery service on
 * /api/x402/v1/markets/discover (`server/src/routes/x402-discovery.ts`), on
 * the house ephemeral-app + factory-overrides pattern (x402-trading.test.ts).
 * The paywall is real; the facilitator behind it is a spy.
 *
 * Covered: unpaid → 402 with BOTH rails; paid → 200 passthrough with the
 * full league board; the league filter narrows the read; the status filter
 * narrows the response; disagreeing league/sport → 400; a read failure →
 * 503; the service absent from X402_SELLER_SERVICES → 503 dark. The
 * composer/aggregates themselves have unit tests (market-discover.test.ts);
 * here they are stubs behind the read seam.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const express = (await import("express")).default;

const SELLER = "0x00000000000000000000000000000000DeaDBeef";
const PAYER = "0x1111111111111111111111111111111111111111";
const PATH = "/api/x402/v1/markets/discover";

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

/** Minimal wire fixture — the composer's deep shape is unit-tested upstream. */
function wire(over: Partial<DiscoverMarketWire>): DiscoverMarketWire {
  return {
    providerEventId: "101",
    startsAt: Date.parse("2026-09-20T18:00:00Z"),
    status: "in_progress",
    home: { name: "Chiefs", key: "kc" },
    away: { name: "Ravens", key: "bal" },
    league: "nfl",
    tradeable: true,
    liquidityUsdc: 12_000,
    volume24hUsdc: 5_000,
    fills24h: 42,
    ...over,
  } as unknown as DiscoverMarketWire;
}

interface Harness {
  readCalls: readonly string[][];
  paid(query: string, payer?: string): Promise<Response>;
}

async function boot(
  over: Partial<X402DiscoveryDeps> & {
    enabledServiceIds?: string[];
    readResult?: DiscoverReadWithUnavailable | Error;
  } = {},
): Promise<Harness> {
  const readCalls: string[][] = [];
  const verifyCalls = { count: 0 };
  const settleCalls = { count: 0 };
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
  const deps: X402DiscoveryDeps = {
    read: (leagues) => {
      readCalls.push([...leagues]);
      const result = over.readResult ?? {
        markets: [
          wire({ providerEventId: "101", status: "in_progress" }),
          wire({ providerEventId: "102", status: "final" }),
        ],
        fetchedAt: Date.now(),
        delayed: false,
        unavailable: [],
      };
      if (result instanceof Error) throw result;
      return Promise.resolve(result);
    },
    paywall: {
      sellerAddress: SELLER,
      enabledServiceIds: over.enabledServiceIds ?? ["market-discovery"],
      auditSale: async () => {}, // hermetic — no DB in unit tests
      vanillaFacilitator: facilitator,
    },
    ...over,
  };
  const app = express();
  app.use(express.json());
  app.use(createX402DiscoveryRouter(deps));
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

  return { readCalls, paid };
}

void describe("paid market-discovery service (MP-005)", () => {
  void it("402s an unpaid request with BOTH rails in accepts", async () => {
    await boot();
    const origin = `http://127.0.0.1:${String(
      (servers[servers.length - 1].address() as { port: number }).port,
    )}`;
    const res = await realFetch(`${origin}${PATH}`);
    assert.equal(res.status, 402, "payment IS the auth — unpaid requests get 402");
    const required = JSON.parse(
      Buffer.from(res.headers.get("payment-required") ?? "", "base64").toString("utf8"),
    ) as { accepts?: { extra?: { name?: string } }[] };
    assert.equal(required.accepts?.length, 2, "one 402, two rails");
    assert.deepEqual(required.accepts[0].extra, { name: "USD Coin", version: "2" });
    assert.equal(required.accepts[1].extra?.name, "GatewayWalletBatched");
  });

  void it("200s a paid request with the full board when unfiltered", async () => {
    const h = await boot();
    const res = await h.paid("");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      markets?: { providerEventId?: string }[];
      unavailable?: string[];
      delayed?: boolean;
    };
    assert.deepEqual(
      body.markets?.map((m) => m.providerEventId),
      ["101", "102"],
    );
    assert.deepEqual(body.unavailable, []);
    assert.deepEqual(h.readCalls, [["nfl", "wnba"]], "no filter reads the whole board");
  });

  void it("narrows the read to the league filter", async () => {
    const h = await boot();
    const res = await h.paid("?league=nfl");
    assert.equal(res.status, 200);
    assert.deepEqual(h.readCalls, [["nfl"]]);
  });

  void it("narrows the response by status after the read", async () => {
    const h = await boot();
    const res = await h.paid("?status=final");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { markets?: { status?: string }[] };
    assert.deepEqual(
      body.markets?.map((m) => m.status),
      ["final"],
      "the status filter applies to the composed board, not the read",
    );
    assert.deepEqual(h.readCalls, [["nfl", "wnba"]]);
  });

  void it("400s when league and sport disagree", async () => {
    const h = await boot();
    const res = await h.paid("?league=nfl&sport=wnba");
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "BAD_REQUEST");
    assert.equal(h.readCalls.length, 0);
  });

  void it("503s when the read fails — the caller paid for an answer", async () => {
    const h = await boot({ readResult: new Error("slates down") });
    const res = await h.paid("");
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "UNAVAILABLE");
  });

  void it("503s dark when the service is absent from X402_SELLER_SERVICES", async () => {
    const h = await boot({ enabledServiceIds: ["trading-quote"] });
    const origin = `http://127.0.0.1:${String(
      (servers[servers.length - 1].address() as { port: number }).port,
    )}`;
    const res = await realFetch(`${origin}${PATH}`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "X402_SERVICE_DISABLED");
    assert.equal(h.readCalls.length, 0);
  });
});
