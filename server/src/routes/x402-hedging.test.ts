import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createX402HedgingRouter, type X402HedgingDeps } from "./x402-hedging.ts";
import { hedgePlans } from "../lib/x402/hedge-templates.ts";
import type { MarketDepthRead } from "../lib/sports/market-depth-read.ts";

/**
 * Phase 17 (MP-010) — tests for the PAID hedging service on
 * /api/x402/v1/hedging/plan (`server/src/routes/x402-hedging.ts`), on the
 * house ephemeral-app + factory-overrides pattern (x402-trading.test.ts).
 * The paywall is real; the facilitator behind it is a spy.
 *
 * Covered: unpaid → 402 with BOTH rails; paid → 200 with the REAL pure
 * template renderer turned into concrete legs at the depth read's price
 * (every leg quotable: amountRaw present) and armsNothing asserted; unknown
 * event → 404; a depth failure → 503; an invalid exposure → 400; absent
 * X402_SELLER_SERVICES → 503 dark. The renderer's internals have unit tests
 * (hedge-templates.test.ts) — this suite pins the wire integration.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const express = (await import("express")).default;

const SELLER = "0x00000000000000000000000000000000DeaDBeef";
const PAYER = "0x1111111111111111111111111111111111111111";
const PATH = "/api/x402/v1/hedging/plan";

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

interface Harness {
  depthCalls: string[];
  paid(query: string, payer?: string): Promise<Response>;
}

async function boot(
  over: Partial<X402HedgingDeps> & {
    enabledServiceIds?: string[];
    depthResult?: MarketDepthRead | null | Error;
  } = {},
): Promise<Harness> {
  const depthCalls: string[] = [];
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
  const deps: X402HedgingDeps = {
    depth: (id) => {
      depthCalls.push(id);
      const result =
        "depthResult" in over
          ? over.depthResult
          : ({
              hasMarkets: true,
              game: { providerEventId: "101" },
              metrics: { priceBps: 5200, source: "pool", capturedAt: 1, change24hBps: null },
              depth: null,
              annotations: [],
              computedAt: 1,
            } as unknown as MarketDepthRead);
      if (result instanceof Error) throw result;
      return Promise.resolve(result);
    },
    plans: over.plans ?? hedgePlans,
    paywall: {
      sellerAddress: SELLER,
      enabledServiceIds: over.enabledServiceIds ?? ["hedging"],
      auditSale: async () => {}, // hermetic — no DB in unit tests
      vanillaFacilitator: facilitator,
    },
    ...over,
  };
  const app = express();
  app.use(express.json());
  app.use(createX402HedgingRouter(deps));
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

  return { depthCalls, paid };
}

interface PlanBody {
  providerEventId?: string;
  side?: string;
  exposureUsd?: number;
  assumedHomePriceBps?: number | null;
  plans?: {
    name?: string;
    quotable?: boolean;
    legs?: { direction?: string; amountRaw?: string; amountUsd?: number }[];
  }[];
  armsNothing?: boolean;
}

void describe("paid hedging service (MP-010)", () => {
  void it("402s an unpaid request with BOTH rails in accepts", async () => {
    await boot();
    const origin = `http://127.0.0.1:${String(
      (servers[servers.length - 1].address() as { port: number }).port,
    )}`;
    const res = await realFetch(`${origin}${PATH}?providerEventId=101&exposureUsd=500`);
    assert.equal(res.status, 402, "payment IS the auth — unpaid requests get 402");
    const required = JSON.parse(
      Buffer.from(res.headers.get("payment-required") ?? "", "base64").toString("utf8"),
    ) as { accepts?: { extra?: { name?: string } }[] };
    assert.equal(required.accepts?.length, 2, "one 402, two rails");
    assert.deepEqual(required.accepts[0].extra, { name: "USD Coin", version: "2" });
    assert.equal(required.accepts[1].extra?.name, "GatewayWalletBatched");
  });

  void it("200s a paid request with the real templates as concrete legs", async () => {
    const h = await boot();
    const res = await h.paid("?providerEventId=101&side=yes&exposureUsd=500");
    assert.equal(res.status, 200);
    const body = (await res.json()) as PlanBody;
    assert.equal(body.providerEventId, "101");
    assert.equal(body.side, "yes");
    assert.equal(body.exposureUsd, 500);
    assert.equal(body.assumedHomePriceBps, 5200, "the price rides the depth read");
    assert.equal(body.armsNothing, true, "the service states its B9-004 discipline");
    assert.ok((body.plans?.length ?? 0) >= 2, "the predefined templates render");
    for (const plan of body.plans ?? []) {
      assert.ok(plan.quotable, `plan ${String(plan.name)} is quotable at a known price`);
      for (const leg of plan.legs ?? []) {
        assert.ok(
          leg.direction === "buy" || leg.direction === "sell",
          "hedge legs reduce (sell) or offset (buy the flip) exposure",
        );
        assert.match(
          leg.amountRaw ?? "",
          /^\d+$/,
          "each leg carries a raw-unit size quotable via the trading services",
        );
      }
    }
    assert.deepEqual(h.depthCalls, ["101"]);
  });

  void it("404s an unknown event", async () => {
    const h = await boot({ depthResult: null });
    const res = await h.paid("?providerEventId=999&exposureUsd=500");
    assert.equal(res.status, 404);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "NOT_FOUND");
  });

  void it("503s when the depth read fails", async () => {
    const h = await boot({ depthResult: new Error("depth db down") });
    const res = await h.paid("?providerEventId=101&exposureUsd=500");
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "UNAVAILABLE");
  });

  void it("400s a non-positive exposure", async () => {
    const h = await boot();
    const res = await h.paid("?providerEventId=101&exposureUsd=0");
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "BAD_REQUEST");
    assert.equal(h.depthCalls.length, 0);
  });

  void it("503s dark when the service is absent from X402_SELLER_SERVICES", async () => {
    const h = await boot({ enabledServiceIds: ["trading-quote"] });
    const origin = `http://127.0.0.1:${String(
      (servers[servers.length - 1].address() as { port: number }).port,
    )}`;
    const res = await realFetch(`${origin}${PATH}?providerEventId=101&exposureUsd=500`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "X402_SERVICE_DISABLED");
    assert.equal(h.depthCalls.length, 0);
  });
});
