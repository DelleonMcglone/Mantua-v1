import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { SafetyError } from "../lib/errors.ts";
import {
  MarketClosedError,
  MarketDataOutageError,
  NoMarketError,
  type BuiltMarketTrade,
} from "../lib/sports/market-trade-build.ts";
import { createX402TradingRouter, type X402TradingDeps } from "./x402-trading.ts";

/**
 * D-106 — tests for the PAID trading services on /api/x402/v1
 * (`server/src/routes/x402-trading.ts`), on the house ephemeral-app +
 * factory-overrides pattern (market-trade.test.ts). The paywall in front of
 * every route is real; the facilitator behind it is a spy, and "paid"
 * requests craft a PAYMENT-SIGNATURE header whose `accepted` row is lifted
 * from the live 402 — so the full paywall → handler → settle → audit flow
 * runs without a signer or a chain.
 *
 * Covered: the quote's read-only cap check (no ledger ink) with
 * capRemainingUsd; the calldata route's guardSpend check → build → record
 * keyed to the SETTLING PAYER; no ink on a refused cap or failed build; the
 * typed failure pass-through (cap_blocked 403 with cap info, BETTING_CLOSED
 * 409, TRADING_HALTED 503, NO_MARKET 404); and sells touching no cap.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const express = (await import("express")).default;

const SELLER = "0x00000000000000000000000000000000DeaDBeef";
const PAYER = "0x1111111111111111111111111111111111111111";
const QUOTE_PATH = "/api/x402/v1/trading/quote";
const CALLDATA_PATH = "/api/x402/v1/trading/calldata";

const VALID_BODY = {
  providerEventId: "ev-1",
  outcomeIndex: 0,
  direction: "buy",
  amountRaw: "5000000", // 5 USDC of input → $5 of cap spend on a buy
  slippageBps: 100,
};

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

function fakeBuilt(over: Partial<BuiltMarketTrade> = {}): BuiltMarketTrade {
  return {
    to: "0x2222222222222222222222222222222222222222",
    data: "0xdeadbeef",
    value: "0",
    approvalTarget: null,
    inputToken: "0x3333333333333333333333333333333333333333",
    marketId: "0x4444444444444444444444444444444444444444",
    marketAddress: "0x5555555555555555555555555555555555555555",
    yesToken: "0x6666666666666666666666666666666666666666",
    sqrtPriceLimitX96: "0",
    quote: {
      amountIn: "5000000",
      amountOut: "4000000",
      amountOutMinimum: "3960000",
      effectivePriceBps: 8000,
    },
    fee: {
      feePips: 100,
      ratePips: 100,
      probabilityBps: 5000,
      playoffs: false,
      stale: false,
      feeRaw: "5000",
      feeUsdcRaw: "5000",
      breakdown: {
        minRate: 0,
        liquidityPremium: 0,
        volatilityPremium: 0,
        activityPremium: 0,
        uncertaintyPremium: 0,
        rate: 100,
        probabilityBps: 5000,
        playoffs: false,
        stale: false,
      },
    },
    ...over,
  };
}

interface Harness {
  buildCalls: Parameters<NonNullable<X402TradingDeps["build"]>>[0][];
  checkCalls: [string, number][];
  recordCalls: [string, number][];
  facilitator: { calls: { verify: number; settle: number } };
  paid(path: string, body: object, payer?: string): Promise<Response>;
}

/**
 * Boot the trading router with injected seams. Defaults: the builder
 * resolves `fakeBuilt()`, the cap allows everything, cap state is
 * {cap: 10, spent: 4} → capRemainingUsd 6, and the paywall's facilitator
 * auto-verifies and auto-settles.
 */
async function boot(
  over: Partial<X402TradingDeps> & {
    buildResult?: BuiltMarketTrade | Error;
    capStateValue?: { capUsd: number; spentUsd: number };
  } = {},
): Promise<Harness> {
  const buildCalls: Parameters<NonNullable<X402TradingDeps["build"]>>[0][] = [];
  const checkCalls: [string, number][] = [];
  const recordCalls: [string, number][] = [];
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
  const deps: X402TradingDeps = {
    build: (args) => {
      buildCalls.push(args);
      const result = over.buildResult ?? fakeBuilt();
      if (result instanceof Error) throw result;
      return Promise.resolve(result);
    },
    spendIo: {
      check: (payer, usd) => {
        checkCalls.push([payer, usd]);
        return Promise.resolve();
      },
      record: (payer, usd) => {
        recordCalls.push([payer, usd]);
        return Promise.resolve();
      },
    },
    capState: () => Promise.resolve(over.capStateValue ?? { capUsd: 10, spentUsd: 4 }),
    paywall: {
      sellerAddress: SELLER,
      enabledServiceIds: ["trading-quote", "trading-calldata"],
      auditSale: async () => {}, // hermetic — no DB in unit tests
      vanillaFacilitator: facilitator,
    },
    ...over,
  };
  const app = express();
  app.use(express.json());
  app.use(createX402TradingRouter(deps));
  await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(addr);
    });
  });
  const addr = (servers[servers.length - 1].address() as { port: number }).port;
  const origin = `http://127.0.0.1:${String(addr)}`;

  async function paid(path: string, body: object, payer = PAYER): Promise<Response> {
    // The 402 dance: an unpaid request captures the PAYMENT-REQUIRED accepts
    // row; the follow-up presents a crafted payment header for `payer`.
    const unpaid = await realFetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(unpaid.status, 402, `prelude: ${path} must 402 an unpaid request`);
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
    return realFetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": payment },
      body: JSON.stringify(body),
    });
  }

  return {
    buildCalls,
    checkCalls,
    recordCalls,
    facilitator,
    paid,
  };
}

void describe("paid trading services (MP-007)", () => {
  void it("quotes with cap state after a read-only cap check — no ledger ink", async () => {
    const t = await boot();
    const res = await t.paid(QUOTE_PATH, VALID_BODY);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      marketId?: string;
      marketAddress?: string;
      yesToken?: string;
      quote?: { amountIn?: string };
      capRemainingUsd?: number;
    };
    assert.equal(body.marketId, "0x4444444444444444444444444444444444444444");
    assert.equal(body.marketAddress, "0x5555555555555555555555555555555555555555");
    assert.equal(body.yesToken, "0x6666666666666666666666666666666666666666");
    assert.equal(body.quote?.amountIn, "5000000");
    assert.equal(body.capRemainingUsd, 6, "cap 10 − spent 4");
    assert.deepEqual(t.checkCalls, [[PAYER, 5]], "read-only cap check keyed to the payer");
    assert.equal(t.recordCalls.length, 0, "a quote never inks the daily ledger");
    assert.equal(t.buildCalls.length, 1);
    assert.equal(t.buildCalls[0].amountRaw, 5000000n, "amountRaw reaches the builder as bigint");
  });

  void it("issues calldata keyed to the settling payer and records the spend", async () => {
    const t = await boot();
    const res = await t.paid(CALLDATA_PATH, VALID_BODY);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      calldata?: string;
      target?: string;
      value?: string;
      quote?: { amountIn?: string };
      fee?: { feePips?: number };
      capRemainingUsd?: number;
      transaction?: string;
    };
    assert.equal(body.calldata, "0xdeadbeef");
    assert.equal(body.target, "0x2222222222222222222222222222222222222222");
    assert.equal(body.value, "0");
    assert.equal(body.quote?.amountIn, "5000000", "calldata carries the quote");
    assert.equal(body.fee?.feePips, 100, "calldata carries the fee quote");
    assert.equal(body.capRemainingUsd, 6);
    assert.equal(body.transaction, undefined, "nothing executes — the caller signs");
    assert.deepEqual(t.checkCalls, [[PAYER, 5]], "cap check keyed to the settling payer");
    assert.deepEqual(t.recordCalls, [[PAYER, 5]], "spend ledger keyed to the settling payer");
  });

  void it("refuses a cap-blocked buy with typed cap_blocked and issues NO calldata", async () => {
    const t = await boot({
      spendIo: {
        check: () =>
          Promise.reject(
            new SafetyError("spending_cap_exceeded", "over cap", {
              cap: 10,
              spent: 12,
              usdAmount: 5,
            }),
          ),
        record: () => Promise.reject(new Error("record must never be reached")),
      },
    });
    const res = await t.paid(CALLDATA_PATH, VALID_BODY);
    assert.equal(res.status, 403);
    const body = (await res.json()) as {
      code?: string;
      dailyCapUsd?: number;
      spentUsd?: number;
      requestedUsd?: number;
      calldata?: string;
    };
    assert.equal(body.code, "cap_blocked");
    assert.equal(body.dailyCapUsd, 10);
    assert.equal(body.spentUsd, 12);
    assert.equal(body.requestedUsd, 5);
    assert.equal(body.calldata, undefined, "a refused trade ships no calldata");
    assert.equal(t.buildCalls.length, 0, "the check fires before the builder");
    assert.equal(t.recordCalls.length, 0, "a refused check leaves no ledger ink");
  });

  void it("refuses a cap-blocked quote with the same typed failure", async () => {
    const t = await boot({
      spendIo: {
        check: () =>
          Promise.reject(
            new SafetyError("spending_cap_exceeded", "over cap", {
              cap: 10,
              spent: 12,
              usdAmount: 5,
            }),
          ),
        record: () => Promise.reject(new Error("record must never be reached")),
      },
    });
    const res = await t.paid(QUOTE_PATH, VALID_BODY);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "cap_blocked");
    assert.equal(t.recordCalls.length, 0);
  });

  void it("never inks the ledger for a failed build (guardSpend leaves no record)", async () => {
    const t = await boot({ buildResult: new MarketClosedError("ev-1") });
    const res = await t.paid(CALLDATA_PATH, VALID_BODY);
    assert.equal(res.status, 409);
    assert.equal(t.checkCalls.length, 1, "the cap check ran");
    assert.equal(t.recordCalls.length, 0, "a failed build leaves no ink");
  });

  void it("treats sells as exits — no cap check, no ink", async () => {
    const t = await boot();
    const res = await t.paid(CALLDATA_PATH, { ...VALID_BODY, direction: "sell" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { calldata?: string; capRemainingUsd?: number };
    assert.equal(body.calldata, "0xdeadbeef");
    assert.equal(body.capRemainingUsd, 6, "cap state is still reported");
    assert.equal(t.checkCalls.length, 0, "sells touch no cap");
    assert.equal(t.recordCalls.length, 0);
  });

  void it("passes the typed market failures through with house statuses", async () => {
    for (const [error, expectedStatus, expectedCode] of [
      [new MarketClosedError("ev-1"), 409, "BETTING_CLOSED"],
      [new MarketDataOutageError("ev-1", "feed stale"), 503, "TRADING_HALTED"],
      [new NoMarketError("ev-1"), 404, "NO_MARKET"],
    ] as const) {
      const t = await boot({ buildResult: error });
      const res = await t.paid(CALLDATA_PATH, VALID_BODY);
      assert.equal(res.status, expectedStatus, `${expectedCode} status`);
      const body = (await res.json()) as { code?: string };
      assert.equal(body.code, expectedCode);
      assert.equal(t.recordCalls.length, 0, "no ink on a typed refusal");
    }
  });

  void it("400s an invalid trade body before touching the cap", async () => {
    const t = await boot();
    const res = await t.paid(QUOTE_PATH, { providerEventId: "" });
    assert.equal(res.status, 400);
    assert.equal(t.checkCalls.length, 0);
    assert.equal(t.buildCalls.length, 0);
  });
});
