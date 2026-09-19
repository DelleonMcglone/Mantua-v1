import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express, { type Router } from "express";
import { encodeEventTopics, parseAbi, toHex, type Log } from "viem";

/**
 * Task 072 / CB-005, CB-010 — /api/combos/calldata and /api/combos/fills
 * boundary: validation, the leg rules and policy gate before any cap
 * contact, ONE cap check + record for the whole stake on a buy and none
 * on a sell, and receipt verification on the fill (success, our router,
 * the caller's own wallet as sender, amounts from the transfer logs).
 * Style: `routes/market-trade.test.ts` — the router built through its
 * factory with fakes, so no chain or database is needed.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { createComboTradeRouter } = await import("./combos-trade.ts");
const { DEFAULT_POLICY } = await import("../lib/agent/policy.ts");
const { SafetyError } = await import("../lib/errors.ts");
type BuiltMarketTrade = import("../lib/sports/market-trade-build.ts").BuiltMarketTrade;
type LegRow = import("../lib/combos/combo-read.ts").LegRow;
type LegCandidate = import("../lib/combos/combo-rules.ts").LegCandidate;

const WALLET = "0x00000000000000000000000000000000000000aa";
const ROUTER = "0x00000000000000000000000000000000000000ee";
const YES = "0x00000000000000000000000000000000000000f1" as const;
const USDC = "0x00000000000000000000000000000000000000c1" as const;
const POOL = "0x00000000000000000000000000000000000000b1" as const;
const MARKET = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;
const LEGS = [
  { providerEventId: "1", outcomeIndex: 0 as const },
  { providerEventId: "2", outcomeIndex: 1 as const },
];
const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function row(id: string): LegRow {
  return {
    marketId: `0x${id.repeat(64)}`,
    providerEventId: id,
    outcomeIndex: 0,
    marketState: "OPEN",
    eventStatus: "scheduled",
    startsAt: new Date(Date.now() + 3_600_000),
    lastPolledAt: new Date(),
    homeTeam: `H${id}`,
    awayTeam: `A${id}`,
    league: "nfl",
  };
}
function candidate(r: LegRow, priceBps = 5_000): LegCandidate {
  return {
    marketId: r.marketId as `0x${string}`,
    providerEventId: r.providerEventId,
    outcomeIndex: 0,
    teamName: r.homeTeam,
    opponentName: r.awayTeam,
    league: r.league,
    kickoffAt: Math.floor(r.startsAt.getTime() / 1000),
    marketState: r.marketState,
    eventStatus: r.eventStatus,
    priceBps,
    playoffs: false,
  };
}
const built = {
  to: ROUTER,
  data: "0x00",
  value: "0",
  quote: {
    amountIn: "10000000",
    amountOut: "60000000",
    amountOutMinimum: "59000000",
    effectivePriceBps: 1666,
  },
} as unknown as BuiltMarketTrade;

const TRANSFER = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
function transfer(
  token: `0x${string}`,
  from: `0x${string}`,
  to: `0x${string}`,
  value: bigint,
): Log {
  return {
    address: token,
    topics: encodeEventTopics({ abi: TRANSFER, eventName: "Transfer", args: { from, to } }),
    data: toHex(value, { size: 32 }),
  } as unknown as Log;
}
const BUY_LOGS = [
  transfer(USDC, WALLET, POOL, 10_000_000n),
  transfer(YES, POOL, WALLET, 60_000_000n),
];

function serve(router: Router, withWallet = true): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test";
    if (withWallet) (req as { walletAddress?: string }).walletAddress = WALLET;
    next();
  });
  app.use(router);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

function fakes(policy = DEFAULT_POLICY, exposure = 0, priceBps = 5_000) {
  const ledger = { checks: [] as number[], records: [] as number[] };
  const builds: string[] = [];
  const recorded: {
    direction: string;
    tokensRaw: bigint;
    usdcRaw: bigint;
    walletAddress: string;
  }[] = [];
  const router = createComboTradeRouter({
    build: (args) => {
      builds.push(args.direction);
      return Promise.resolve(built);
    },
    spendIo: {
      check: (_a, usd) => {
        ledger.checks.push(usd);
        if (usd > 500) throw new SafetyError("spending_cap_exceeded", "cap");
        return Promise.resolve();
      },
      record: (_a, usd) => {
        ledger.records.push(usd);
        return Promise.resolve();
      },
    },
    userIdOf: () => Promise.resolve("user-1"),
    context: () => {
      const rows = [row("1"), row("2")];
      return Promise.resolve({
        rows,
        candidates: rows.map((r) => candidate(r, priceBps)),
        legs: rows.map((r) => ({ row: r, result: "pending" as const })),
        policy,
        openExposureUsd: exposure,
      });
    },
    receipt: (_c, hash) =>
      Promise.resolve({
        status: hash === TX ? "success" : "reverted",
        to: ROUTER,
        from: WALLET,
        logs: BUY_LOGS,
      }),
    swapRouterFor: () => ROUTER,
    market: () =>
      Promise.resolve({
        onChain: {
          marketAddress: POOL,
          yesToken: YES,
          poolId: "0x1",
          state: "OPEN" as const,
          markBps: null,
        },
        usdc: USDC,
      }),
    record: (_db, fill) => {
      recorded.push({
        direction: fill.direction,
        tokensRaw: fill.tokensRaw,
        usdcRaw: fill.usdcRaw,
        walletAddress: fill.walletAddress,
      });
      return Promise.resolve({ kind: "placed" as const, comboId: "placed-1" });
    },
  });
  return { router, ledger, builds, recorded };
}

async function post(origin: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const code = async (res: Response) => ((await res.json()) as { code: string }).code;

void describe("POST /api/combos/calldata", () => {
  void it("rejects a bad body and a missing wallet before any work", async () => {
    const { router, ledger, builds } = fakes();
    const origin = await serve(router);
    assert.equal(
      (
        await post(origin, "/api/combos/calldata", {
          marketId: MARKET,
          legs: LEGS.slice(0, 1),
          amountRaw: "1",
        })
      ).status,
      400,
    );
    assert.equal(
      (await post(origin, "/api/combos/calldata", { marketId: "nope", legs: LEGS, amountRaw: "1" }))
        .status,
      400,
    );
    assert.equal(
      (
        await post(await serve(router, false), "/api/combos/calldata", {
          marketId: MARKET,
          legs: LEGS,
          amountRaw: "1000000",
        })
      ).status,
      401,
    );
    assert.deepEqual([ledger.checks, ledger.records, builds], [[], [], []]);
  });

  void it("a buy is cap-checked and recorded once for the whole stake; a sell touches no cap", async () => {
    const { router, ledger, builds } = fakes();
    const origin = await serve(router);
    assert.equal(
      (
        await post(origin, "/api/combos/calldata", {
          marketId: MARKET,
          legs: LEGS,
          direction: "buy",
          amountRaw: "10000000",
        })
      ).status,
      200,
    );
    assert.deepEqual(ledger, { checks: [10], records: [10] });
    assert.equal(
      (
        await post(origin, "/api/combos/calldata", {
          marketId: MARKET,
          legs: LEGS,
          direction: "sell",
          amountRaw: "5000000",
        })
      ).status,
      200,
    );
    assert.deepEqual(ledger, { checks: [10], records: [10] });
    assert.deepEqual(builds, ["buy", "sell"]);
  });

  void it("the rules and the policy gate (with the implied payout) refuse before the cap; a cap refusal leaves no record", async () => {
    const stake = fakes({ ...DEFAULT_POLICY, combo: { ...DEFAULT_POLICY.combo, maxStakeUsd: 5 } });
    const res = await post(await serve(stake.router), "/api/combos/calldata", {
      marketId: MARKET,
      legs: LEGS,
      amountRaw: "10000000",
    });
    assert.equal(res.status, 400);
    assert.equal(await code(res), "COMBO_POLICY");
    assert.deepEqual(stake.ledger, { checks: [], records: [] });
    // $10 at 1% × 1% fair pays $100,000 — above the default $1,000 payout limit.
    const payout = fakes(DEFAULT_POLICY, 0, 100);
    const res2 = await post(await serve(payout.router), "/api/combos/calldata", {
      marketId: MARKET,
      legs: LEGS,
      amountRaw: "10000000",
    });
    assert.equal(await code(res2), "COMBO_POLICY");
    assert.deepEqual(payout.ledger, { checks: [], records: [] });
    const big = fakes({
      ...DEFAULT_POLICY,
      combo: {
        ...DEFAULT_POLICY.combo,
        maxStakeUsd: 100_000,
        maxOpenExposureUsd: 100_000,
        maxPayoutUsd: 1e7,
      },
    });
    const res3 = await post(await serve(big.router), "/api/combos/calldata", {
      marketId: MARKET,
      legs: LEGS,
      amountRaw: "600000000",
    });
    assert.equal(res3.status, 400);
    assert.deepEqual(big.ledger, { checks: [600], records: [] });
  });
});

void describe("POST /api/combos/fills", () => {
  void it("verifies the receipt and records the amounts the logs show, for the caller's own wallet", async () => {
    const { router, recorded } = fakes();
    const origin = await serve(router);
    const body = { txHash: TX, marketId: MARKET, legs: LEGS, direction: "buy" };
    const ok = await post(origin, "/api/combos/fills", body);
    assert.equal(ok.status, 201);
    assert.deepEqual(await ok.json(), { ok: true, kind: "placed", comboId: "placed-1" });
    assert.deepEqual(recorded, [
      { direction: "buy", tokensRaw: 60_000_000n, usdcRaw: 10_000_000n, walletAddress: WALLET },
    ]);
    const reverted = await post(origin, "/api/combos/fills", {
      ...body,
      txHash: `0x${"ef".repeat(32)}`,
    });
    assert.equal(reverted.status, 422);
    assert.equal(await code(reverted), "TX_FAILED");
    const asSell = await post(origin, "/api/combos/fills", { ...body, direction: "sell" });
    assert.equal(await code(asSell), "WRONG_MARKET", "a buy receipt is not a sell");
  });

  void it("refuses another wallet's transaction, the wrong target, and a receipt without this combo's token", async () => {
    const base = { txHash: TX, marketId: MARKET, legs: LEGS, direction: "buy" };
    const theirs = createComboTradeRouter({
      receipt: () => Promise.resolve({ status: "success", to: ROUTER, from: POOL, logs: BUY_LOGS }),
      swapRouterFor: () => ROUTER,
      userIdOf: () => Promise.resolve("u"),
    });
    assert.equal(
      await code(await post(await serve(theirs), "/api/combos/fills", base)),
      "WALLET_MISMATCH",
    );
    const wrong = createComboTradeRouter({
      receipt: () =>
        Promise.resolve({ status: "success", to: WALLET, from: WALLET, logs: BUY_LOGS }),
      swapRouterFor: () => ROUTER,
      userIdOf: () => Promise.resolve("u"),
    });
    assert.equal(
      await code(await post(await serve(wrong), "/api/combos/fills", base)),
      "WRONG_TARGET",
    );
    const other = createComboTradeRouter({
      receipt: () =>
        Promise.resolve({ status: "success", to: ROUTER, from: WALLET, logs: BUY_LOGS }),
      swapRouterFor: () => ROUTER,
      userIdOf: () => Promise.resolve("u"),
      market: () =>
        Promise.resolve({
          onChain: {
            marketAddress: POOL,
            yesToken: POOL,
            poolId: "0x1",
            state: "OPEN" as const,
            markBps: null,
          },
          usdc: USDC,
        }),
    });
    assert.equal(
      await code(await post(await serve(other), "/api/combos/fills", base)),
      "WRONG_MARKET",
    );
  });
});
