import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createX402IntelligenceRouter, type X402IntelligenceDeps } from "./x402-intelligence.ts";
import type { MarketDepthRead } from "../lib/sports/market-depth-read.ts";
import type { TradeSignals } from "../lib/agent-signals.ts";
import type { HistoryRow } from "../lib/sports/market-history.ts";

/**
 * Phase 17 (MP-006) — tests for the PAID market-intelligence service on
 * /api/x402/v1/intelligence/market (`server/src/routes/x402-intelligence.ts`),
 * on the house ephemeral-app + factory-overrides pattern
 * (x402-trading.test.ts). The paywall is real; the facilitator behind it is
 * a spy.
 *
 * Covered: unpaid → 402 with BOTH rails; paid → 200 with the win-probability
 * conversion (bps → probability → American odds) and liquidity/price-
 * movement/sports context; unknown event → 404; the signals and history
 * context reads degrade to explicit nulls WITH notes, not silent gaps; a
 * depth failure → 503; bad id → 400; absent X402_SELLER_SERVICES → 503
 * dark. Depth-metrics internals have unit tests (market-depth-read.test.ts)
 * — fixtures here are minimal wire shapes behind the seams.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const express = (await import("express")).default;

const SELLER = "0x00000000000000000000000000000000DeaDBeef";
const PAYER = "0x1111111111111111111111111111111111111111";
const PATH = "/api/x402/v1/intelligence/market";

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

/** Minimal depth fixture — the handler reads hasMarkets/metrics/game/computedAt. */
function fakeDepth(over: Partial<MarketDepthRead> = {}): MarketDepthRead {
  return {
    hasMarkets: true,
    game: { providerEventId: "101" } as unknown as MarketDepthRead["game"],
    metrics: {
      priceBps: 5200,
      source: "pool",
      capturedAt: 1_760_000_000_000,
      change24hBps: -50,
      volume: {},
      activity: {},
      openInterest: { contractsOpen: 10, positions: 5, supply: 1000 },
      timing: {},
    } as unknown as NonNullable<MarketDepthRead["metrics"]>,
    depth: null,
    annotations: [],
    computedAt: 1_760_000_000_000,
    ...over,
  };
}

interface Harness {
  depthCalls: string[];
  paid(query: string, payer?: string): Promise<Response>;
}

async function boot(
  over: Partial<X402IntelligenceDeps> & {
    enabledServiceIds?: string[];
    depthResult?: MarketDepthRead | null | Error;
    signalsReject?: boolean;
    historyReject?: boolean;
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
  const deps: X402IntelligenceDeps = {
    depth: (id) => {
      depthCalls.push(id);
      const result = "depthResult" in over ? over.depthResult : fakeDepth();
      if (result instanceof Error) throw result;
      return Promise.resolve(result);
    },
    signals: () =>
      over.signalsReject
        ? Promise.reject(new Error("peg feed down"))
        : Promise.resolve({
            thresholds: {},
            prices: { usdc: 1 },
            pegs: [],
            verdict: { ok: true, reasons: [] },
          } as unknown as TradeSignals),
    history: () =>
      over.historyReject
        ? Promise.reject(new Error("history down"))
        : Promise.resolve([
            {
              league: "nfl",
              homeTeam: "Chiefs",
              awayTeam: "Bills",
              startsAt: 1_759_000_000_000,
              state: "final",
              resolvedAt: 1_759_100_000_000,
              outcome: "home",
              settlementPriceBps: 10_000,
            } as unknown as HistoryRow,
          ]),
    paywall: {
      sellerAddress: SELLER,
      enabledServiceIds: over.enabledServiceIds ?? ["market-intelligence"],
      auditSale: async () => {}, // hermetic — no DB in unit tests
      vanillaFacilitator: facilitator,
    },
    ...over,
  };
  const app = express();
  app.use(express.json());
  app.use(createX402IntelligenceRouter(deps));
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

void describe("paid market-intelligence service (MP-006)", () => {
  void it("402s an unpaid request with BOTH rails in accepts", async () => {
    await boot();
    const origin = `http://127.0.0.1:${String(
      (servers[servers.length - 1].address() as { port: number }).port,
    )}`;
    const res = await realFetch(`${origin}${PATH}?providerEventId=101`);
    assert.equal(res.status, 402, "payment IS the auth — unpaid requests get 402");
    const required = JSON.parse(
      Buffer.from(res.headers.get("payment-required") ?? "", "base64").toString("utf8"),
    ) as { accepts?: { extra?: { name?: string } }[] };
    assert.equal(required.accepts?.length, 2, "one 402, two rails");
    assert.deepEqual(required.accepts[0].extra, { name: "USD Coin", version: "2" });
    assert.equal(required.accepts[1].extra?.name, "GatewayWalletBatched");
  });

  void it("200s a paid request with win probability, liquidity, and context", async () => {
    const h = await boot();
    const res = await h.paid("?providerEventId=101");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      providerEventId: string;
      hasMarkets: boolean;
      winProbability: {
        homeProbabilityBps: number | null;
        homeProbability: number | null;
        homeAmericanOdds: number | null;
        source: string | null;
      };
      priceMovement: { change24hBps: number | null };
      liquidity: { openInterest: { contractsOpen: number } | null } | null;
      sportsContext: { game: { providerEventId: string } | null };
      computedAt: number;
    };
    assert.equal(body.providerEventId, "101");
    assert.equal(body.hasMarkets, true);
    assert.equal(body.winProbability.homeProbabilityBps, 5200);
    assert.ok(
      Math.abs((body.winProbability.homeProbability ?? 0) - 0.52) < 1e-9,
      "bps converts to a probability",
    );
    assert.ok(body.winProbability.homeAmericanOdds !== null, "American odds are derived");
    assert.equal(body.winProbability.source, "pool");
    assert.equal(body.priceMovement.change24hBps, -50);
    assert.equal(body.liquidity?.openInterest?.contractsOpen, 10);
    assert.equal(body.sportsContext.game?.providerEventId, "101");
    assert.deepEqual(h.depthCalls, ["101"]);
  });

  void it("404s an unknown event", async () => {
    const h = await boot({ depthResult: null });
    const res = await h.paid("?providerEventId=999");
    assert.equal(res.status, 404);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "NOT_FOUND");
  });

  void it("degrades a failed signals read to null WITH a note — never a silent gap", async () => {
    const h = await boot({ signalsReject: true });
    const res = await h.paid("?providerEventId=101");
    assert.equal(res.status, 200, "a context failure must not sink the paid answer");
    const body = (await res.json()) as {
      marketEnvironment?: unknown;
      marketEnvironmentNote?: string;
    };
    assert.equal(body.marketEnvironment, null);
    assert.equal(body.marketEnvironmentNote, "trade-signal environment unavailable");
  });

  void it("degrades a failed history read to null WITH a note", async () => {
    const h = await boot({ historyReject: true });
    const res = await h.paid("?providerEventId=101");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      resolvedComparable?: unknown;
      resolvedComparableNote?: string;
    };
    assert.equal(body.resolvedComparable, null);
    assert.equal(body.resolvedComparableNote, "resolved-market history unavailable");
  });

  void it("503s when the depth read fails", async () => {
    const h = await boot({ depthResult: new Error("depth db down") });
    const res = await h.paid("?providerEventId=101");
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "UNAVAILABLE");
  });

  void it("400s a non-numeric providerEventId", async () => {
    const h = await boot();
    const res = await h.paid("?providerEventId=abc");
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
    const res = await realFetch(`${origin}${PATH}?providerEventId=101`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "X402_SERVICE_DISABLED");
    assert.equal(h.depthCalls.length, 0);
  });
});
