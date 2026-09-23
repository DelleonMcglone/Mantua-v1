/**
 * 033 — /api/markets/trade/calldata gating + slippage validation.
 * 050 — /api/markets/trade/quote leaves the daily ledger untouched;
 *       /api/markets/trade/calldata inks it exactly once (C-019).
 *
 * B7 edge case: with MARKETS_BY_CHAIN empty (simulated for this file — Base
 * has the real entries), a market-pool route must surface the gated
 * state as a typed response (503 MARKETS_NOT_DEPLOYED), never an opaque
 * 502. The sell direction is used so no spending-cap/DB machinery runs —
 * the request path is auth → validation → buildMarketTrade, which throws
 * MarketsNotDeployedError before any RPC.
 *
 * The cap tests build the router through `createMarketTradeRouter` with a
 * fake builder (no deployed stack needed) and a running ledger fake (the
 * agent-e2e.test convention: check enforces against what record has
 * accumulated), so each endpoint's exact ledger contact is asserted.
 *
 * Style: matches `routes/v4-swap.test.ts` — the real router on an
 * ephemeral express app; auth satisfied by pre-setting req.privyUserId
 * (and req.walletAddress, which this route also requires).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express, { type Router } from "express";
import { MAX_SLIPPAGE_BPS } from "../lib/constants.ts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { marketTradeRouter, createMarketTradeRouter } = await import("./market-trade.ts");
const { SafetyError } = await import("../lib/errors.ts");

// Base carries the real market registries now; these routes are exercised
// in the gated (undeployed) state, so remove the entries for this file and
// put them back when it finishes.
const { UNDEPLOYED, overrideMarketsRegistry } = await import("../lib/testing/markets-registry.ts");
const restoreRegistry = overrideMarketsRegistry(UNDEPLOYED);

type SpendGuardIo = import("../lib/spending-cap.ts").SpendGuardIo;
type BuiltMarketTrade = import("../lib/sports/market-trade-build.ts").BuiltMarketTrade;
type BuildMarketTrade = typeof import("../lib/sports/market-trade-build.ts").buildMarketTrade;

const WALLET = "0x00000000000000000000000000000000000000aa";

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
  restoreRegistry();
});

function serve(withWallet: boolean, router: Router = marketTradeRouter): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    if (withWallet) req.walletAddress = WALLET;
    next();
  });
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

function post(
  origin: string,
  path: "/api/markets/trade/calldata" | "/api/markets/trade/quote",
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerEventId: "401547401",
      outcomeIndex: 0,
      direction: "sell",
      amountRaw: "1000000",
      ...body,
    }),
  });
}

function postTrade(origin: string, body: Record<string, unknown>): Promise<Response> {
  return post(origin, "/api/markets/trade/calldata", body);
}

// ─── Seam fakes ─────────────────────────────────────────────────────────────

/** Running daily ledger (agent-e2e.test's SpendGuardIo fake): check enforces
 *  against what record has accumulated; every call is logged. */
function makeLedger(capUsd: number): {
  io: SpendGuardIo;
  calls: string[];
  spent: () => number;
} {
  const calls: string[] = [];
  let spent = 0;
  const io: SpendGuardIo = {
    check: (_address, usd) => {
      calls.push(`check:${String(usd)}`);
      if (spent + usd > capUsd) {
        return Promise.reject(
          new SafetyError(
            "spending_cap_exceeded",
            `Daily cap $${String(capUsd)} would be exceeded ($${String(spent)} already spent today, +$${String(usd)}).`,
            { cap: capUsd, spent, usdAmount: usd },
          ),
        );
      }
      return Promise.resolve();
    },
    record: (_address, usd) => {
      calls.push(`record:${String(usd)}`);
      spent += usd;
      return Promise.resolve();
    },
  };
  return { io, calls, spent: () => spent };
}

/** A deterministic built trade: the quoter "fills" 1 YES per 0.5 USDC. */
function fakeBuild(): { build: BuildMarketTrade; builds: string[] } {
  const builds: string[] = [];
  const build: BuildMarketTrade = (args) => {
    builds.push(`${args.direction}:${String(args.amountRaw)}`);
    const amountOut = args.direction === "buy" ? args.amountRaw * 2n : args.amountRaw / 2n;
    const built: BuiltMarketTrade = {
      to: "0x00000000000000000000000000000000000000f1",
      data: "0xdeadbeef",
      value: "0",
      approvalTarget: "0x00000000000000000000000000000000000000f1",
      inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      marketId: `0x${"11".repeat(32)}`,
      marketAddress: "0x00000000000000000000000000000000000000e1",
      yesToken: "0x00000000000000000000000000000000000000e2",
      sqrtPriceLimitX96: "79228162514264337593543950336",
      quote: {
        amountIn: args.amountRaw.toString(),
        amountOut: amountOut.toString(),
        amountOutMinimum: ((amountOut * 9_950n) / 10_000n).toString(),
        effectivePriceBps: 5_000,
      },
      fee: {
        feePips: 0,
        ratePips: 0,
        probabilityBps: 5_000,
        playoffs: false,
        stale: false,
        feeRaw: "0",
        feeUsdcRaw: "0",
        breakdown: {
          minRate: 0,
          liquidityPremium: 0,
          volatilityPremium: 0,
          activityPremium: 0,
          uncertaintyPremium: 0,
          rate: 0,
          probabilityBps: 5_000,
          playoffs: false,
          stale: false,
        },
      },
    };
    return Promise.resolve(built);
  };
  return { build, builds };
}

function capRouter(capUsd: number) {
  const ledger = makeLedger(capUsd);
  const builder = fakeBuild();
  const router = createMarketTradeRouter({
    build: builder.build,
    checkCap: ledger.io.check,
    spendIo: ledger.io,
  });
  return { router, ledger, builds: builder.builds };
}

// ─── 033 — gating + validation (unchanged) ──────────────────────────────────

void describe("POST /api/markets/trade/calldata", () => {
  void it("surfaces the gated state (503 MARKETS_NOT_DEPLOYED) while markets are undeployed — not an opaque 502", async () => {
    const origin = await serve(true);
    const res = await postTrade(origin, {});
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string; error?: string };
    assert.equal(body.code, "MARKETS_NOT_DEPLOYED");
    assert.match(body.error ?? "", /not deployed/);
  });

  void it("rejects slippageBps above MAX_SLIPPAGE_BPS with a 400 before any build work", async () => {
    const origin = await serve(true);
    for (const bps of [MAX_SLIPPAGE_BPS + 1, 10_000]) {
      const res = await postTrade(origin, { slippageBps: bps });
      assert.equal(res.status, 400, `slippageBps=${String(bps)}`);
      const body = (await res.json()) as { code?: string };
      assert.equal(body.code, "BAD_REQUEST");
    }
  });

  void it("accepts slippageBps at exactly the cap (fails on the deployment gate, not validation)", async () => {
    const origin = await serve(true);
    const res = await postTrade(origin, { slippageBps: MAX_SLIPPAGE_BPS });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "MARKETS_NOT_DEPLOYED");
  });

  void it("still requires a linked wallet (401 WALLET_REQUIRED)", async () => {
    const origin = await serve(false);
    const res = await postTrade(origin, {});
    assert.equal(res.status, 401);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "WALLET_REQUIRED");
  });
});

// ─── 050 — the quote route burns no cap headroom ────────────────────────────

void describe("POST /api/markets/trade/quote (task 050 — quotes leave the ledger unchanged)", () => {
  void it("shares the calldata route's gating and validation (503 while undeployed, 400 on bad slippage, 401 without a wallet)", async () => {
    const withWallet = await serve(true);
    const gated = await post(withWallet, "/api/markets/trade/quote", {});
    assert.equal(gated.status, 503);
    assert.equal(((await gated.json()) as { code?: string }).code, "MARKETS_NOT_DEPLOYED");

    const bad = await post(withWallet, "/api/markets/trade/quote", {
      slippageBps: MAX_SLIPPAGE_BPS + 1,
    });
    assert.equal(bad.status, 400);

    const noWallet = await serve(false);
    const unlinked = await post(noWallet, "/api/markets/trade/quote", {});
    assert.equal(unlinked.status, 401);
    assert.equal(((await unlinked.json()) as { code?: string }).code, "WALLET_REQUIRED");
  });

  void it("a user trying several buy sizes is cap-CHECKED each time and never RECORDED — the ledger is unchanged after N quotes", async () => {
    const { router, ledger, builds } = capRouter(100);
    const origin = await serve(true, router);

    // The ticket re-quotes on every amount change (400 ms debounce): 10,
    // 25, 40, 60, 80 USDC — 215 USDC of quotes against a 100 USDC cap.
    const sizes = ["10000000", "25000000", "40000000", "60000000", "80000000"];
    for (const amountRaw of sizes) {
      const res = await post(origin, "/api/markets/trade/quote", { direction: "buy", amountRaw });
      assert.equal(res.status, 200, `quote ${amountRaw}`);
      const body = (await res.json()) as Record<string, unknown> & { quote: { amountIn: string } };
      assert.equal(body.quote.amountIn, amountRaw);
      // Nothing signable leaves the quote route.
      assert.equal(body["to"], undefined, "no target address in a quote");
      assert.equal(body["data"], undefined, "no calldata in a quote");
      assert.equal(body["value"], undefined);
      assert.equal(body["approvalTarget"], undefined);
      assert.equal(body["sqrtPriceLimitX96"], undefined);
    }

    assert.deepEqual(
      ledger.calls,
      ["check:10", "check:25", "check:40", "check:60", "check:80"],
      "every quote is checked against the cap, none is recorded",
    );
    assert.equal(ledger.spent(), 0, "five quotes, zero ink — the daily cap is untouched");
    assert.equal(builds.length, sizes.length, "each quote ran the builder");
    // The headroom is intact: a full-cap buy still quotes.
    const full = await post(origin, "/api/markets/trade/quote", {
      direction: "buy",
      amountRaw: "100000000",
    });
    assert.equal(full.status, 200);
    assert.equal(ledger.spent(), 0);
  });

  void it("a buy over the cap is refused at the quote with the cap error, before any build and with no ink", async () => {
    const { router, ledger, builds } = capRouter(50);
    const origin = await serve(true, router);
    const res = await post(origin, "/api/markets/trade/quote", {
      direction: "buy",
      amountRaw: "75000000",
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string; details?: { cap?: number } };
    assert.equal(body.code, "spending_cap_exceeded");
    assert.equal(body.details?.cap, 50);
    assert.deepEqual(ledger.calls, ["check:75"]);
    assert.equal(builds.length, 0, "the check precedes the build");
    assert.equal(ledger.spent(), 0);
  });

  void it("sells (exits) touch no cap on the quote route at all", async () => {
    const { router, ledger, builds } = capRouter(0);
    const origin = await serve(true, router);
    const res = await post(origin, "/api/markets/trade/quote", {
      direction: "sell",
      amountRaw: "5000000",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(ledger.calls, [], "no check, no record for an exit — even with a $0 cap");
    assert.deepEqual(builds, ["sell:5000000"]);
  });
});

// ─── 050 — calldata issuance is the one place a buy inks the ledger ─────────

void describe("POST /api/markets/trade/calldata (task 050 — C-019 ink at issuance, once)", () => {
  void it("runs check → build → record exactly once and returns signable calldata", async () => {
    const { router, ledger, builds } = capRouter(100);
    const origin = await serve(true, router);
    const res = await post(origin, "/api/markets/trade/calldata", {
      direction: "buy",
      amountRaw: "40000000",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { to?: string; data?: string; quote: { amountIn: string } };
    assert.equal(body.to, "0x00000000000000000000000000000000000000f1");
    assert.equal(body.data, "0xdeadbeef");
    assert.equal(body.quote.amountIn, "40000000");
    assert.deepEqual(ledger.calls, ["check:40", "record:40"], "C-019: check, issue, record");
    assert.deepEqual(builds, ["buy:40000000"]);
    assert.equal(ledger.spent(), 40, "the intent is inked at issuance — once");
  });

  // The intent's effect on the NEXT quote and the NEXT calldata request
  // (a signed buy cannot be quoted or signed around) is the second journey
  // in market-trade-cap-e2e.test.ts — kept there so this file stays under
  // the write limiter's 20 requests/minute (it counts per process).

  void it("a failed build leaves no ink (check ran, record did not)", async () => {
    const ledger = makeLedger(100);
    const router = createMarketTradeRouter({
      build: () => Promise.reject(new Error("quoter reverted")),
      checkCap: ledger.io.check,
      spendIo: ledger.io,
    });
    const origin = await serve(true, router);
    const res = await post(origin, "/api/markets/trade/calldata", {
      direction: "buy",
      amountRaw: "10000000",
    });
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as { code?: string }).code, "QUOTE_FAILED");
    assert.deepEqual(ledger.calls, ["check:10"]);
    assert.equal(ledger.spent(), 0);
  });
});
