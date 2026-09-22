import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

/**
 * Task 050 — market trade E2E: quote → quote → quote → calldata → sign →
 * verified fill → replayed fill, against ONE daily ledger.
 *
 * One continuous journey through the SHIPPED routers, each stage's output
 * the genuine input of the next (the agent-e2e.test convention):
 *
 *   1. QUOTE ×N — the trade ticket re-quotes on every amount change
 *      (`use-market-trade.ts`, 400 ms debounce). Each quote runs the
 *      read-only cap check and the real builder path through
 *      `createMarketTradeRouter`; the invariant is ZERO ledger ink — the
 *      user who tries five sizes has spent nothing.
 *   2. CALLDATA — the user commits: `/api/markets/trade/calldata` runs the
 *      real `guardSpend` (C-019: check → issue → record) and inks the
 *      intent exactly once. This is the only ink in the whole journey.
 *   3. SIGN — the wallet submits the calldata; the chain produces a receipt
 *      whose target is our swap router and whose sender is the wallet.
 *   4. FILL — `/api/markets/fills` verifies that receipt through the real
 *      router (status, target, sender), inserts the fill once, runs the
 *      P-011/P-006 bookkeeping once, and writes the ledger NEVER.
 *   5. REPLAY — the same fill report again: the tx_hash conflict means no
 *      row, no bookkeeping, and — still — no ledger write.
 *
 * Stubs sit only at the seams the routers expose: the builder (no market
 * stack is deployed in this repo state), the SpendGuardIo daily ledger (a
 * running fake — check enforces against what record accumulated), the
 * receipt reader, and the fill store.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
// R-008's sanctioned per-IP bypass: every journey below drives the write
// routes from 127.0.0.1, which the 20/min writeRateLimiter would refuse.
// Unset in production there is no bypass at all (see middleware/rate-limit).
process.env.LOAD_TEST_SECRET ??= "market-trade-e2e";

const { createMarketTradeRouter } = await import("./market-trade.ts");
const { createMarketFillsRouter } = await import("./market-fills.ts");
const { SafetyError } = await import("../lib/errors.ts");
const { POOL_SWAP_TEST_ABI } = await import("../lib/v4-contracts.ts");
const { encodeFunctionData } = await import("viem");

type SpendGuardIo = import("../lib/spending-cap.ts").SpendGuardIo;
type BuiltMarketTrade = import("../lib/sports/market-trade-build.ts").BuiltMarketTrade;
type BuildMarketTrade = typeof import("../lib/sports/market-trade-build.ts").buildMarketTrade;
type MarketFillsDeps = import("./market-fills.ts").MarketFillsDeps;

const WALLET = "0x00000000000000000000000000000000000000aa";
const SWAP_ROUTER = "0x00000000000000000000000000000000000000f1";
const MARKET_ID: `0x${string}` = `0x${"11".repeat(32)}`;
const TX = `0x${"c".repeat(64)}`;
const REVERTED_TX = `0x${"d".repeat(64)}`;
/** The pool this market trades in: YES sorts below USDC, so YES is currency0. */
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const YES = "0x00000000000000000000000000000000000000e2" as const;
const HOOK = "0x00000000000000000000000000000000000000e3" as const;

/**
 * C-024 — the bytes a wallet actually signs for one of our swaps, encoded
 * through the SAME ABI the builder uses. `side: "buy"` spends USDC (the
 * collateral, currency1, so not zeroForOne); `side: "sell"` spends YES.
 * Exact-input is the negative `amountSpecified` v4-core expects.
 */
function signedSwapCalldata(side: "buy" | "sell", amountInRaw: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: POOL_SWAP_TEST_ABI,
    functionName: "swap",
    args: [
      { currency0: YES, currency1: USDC, fee: 0, tickSpacing: 60, hooks: HOOK },
      {
        zeroForOne: side === "sell",
        amountSpecified: -amountInRaw,
        sqrtPriceLimitX96: 79_228_162_514_264_337_593_543_950_336n,
      },
      { takeClaims: false, settleUsingBurn: false },
      "0x",
    ],
  });
}

const servers: Server[] = [];
const activityEntries: import("../lib/activity.ts").ActivityInput[] = [];
const activityKeys = new Set<string>();
after(() => {
  for (const s of servers) s.close();
});

// ─── Seam fakes ─────────────────────────────────────────────────────────────

/** Running daily ledger: check enforces against what record accumulated. */
function makeLedger(capUsd: number): {
  io: SpendGuardIo;
  release: MarketFillsDeps["releaseIntent"];
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
  // C-015/C-024 — the reversal side of the same ledger, floored at zero.
  const release: MarketFillsDeps["releaseIntent"] = (_address, usd) => {
    calls.push(`release:${String(usd)}`);
    spent = Math.max(0, spent - usd);
    return Promise.resolve();
  };
  return { io, release, calls, spent: () => spent };
}

/** The builder: 1 YES per 0.5 USDC, calldata targeting our swap router. */
const build: BuildMarketTrade = (args) => {
  const amountOut = args.direction === "buy" ? args.amountRaw * 2n : args.amountRaw / 2n;
  const built: BuiltMarketTrade = {
    to: SWAP_ROUTER,
    data: `0x${args.amountRaw.toString(16).padStart(64, "0")}`,
    value: "0",
    approvalTarget: SWAP_ROUTER,
    inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    marketId: MARKET_ID,
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

/** The chain after the wallet signed: one mined tx per hash we "sent". */
interface MinedTx {
  to: `0x${string}`;
  from: `0x${string}`;
  status: "success" | "reverted";
  /** The calldata the wallet signed — what C-024 prices a release from. */
  input?: `0x${string}`;
}

function makeChain(): {
  mined: Map<string, MinedTx>;
  rpc: MarketFillsDeps["rpc"];
  reads: () => number;
} {
  const mined = new Map<string, MinedTx>();
  let reads = 0;
  const rpc: MarketFillsDeps["rpc"] = () => ({
    getTransactionReceipt: ({ hash }) => {
      reads += 1;
      const tx = mined.get(hash.toLowerCase());
      if (!tx) return Promise.reject(new Error("receipt not found"));
      return Promise.resolve({ status: tx.status, logs: [] });
    },
    getTransaction: ({ hash }) => {
      const tx = mined.get(hash.toLowerCase());
      if (!tx) return Promise.reject(new Error("tx not found"));
      return Promise.resolve({ to: tx.to, from: tx.from, input: tx.input ?? "0x" });
    },
  });
  return { mined, rpc, reads: () => reads };
}

/** The fill store: unique on tx_hash, like `market_fills`. */
function makeFillStore(): {
  insertFill: MarketFillsDeps["insertFill"];
  recordArtifacts: MarketFillsDeps["recordArtifacts"];
  rows: { txHash: string; usdcRaw: string; direction: string }[];
  artifacts: string[];
} {
  const rows: { txHash: string; usdcRaw: string; direction: string }[] = [];
  const artifacts: string[] = [];
  return {
    rows,
    artifacts,
    insertFill: (row) => {
      if (rows.some((r) => r.txHash === row.txHash)) return Promise.resolve(false);
      rows.push({ txHash: row.txHash, usdcRaw: row.usdcRaw, direction: row.direction });
      return Promise.resolve(true);
    },
    recordArtifacts: (_user, marketId, direction, _tokens, usdcRaw) => {
      artifacts.push(`${direction}:${marketId}:${usdcRaw}`);
      return Promise.resolve();
    },
  };
}

function serve(capUsd: number) {
  const ledger = makeLedger(capUsd);
  const chain = makeChain();
  const fills = makeFillStore();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    req.walletAddress = WALLET;
    next();
  });
  app.use(createMarketTradeRouter({ build, checkCap: ledger.io.check, spendIo: ledger.io }));
  app.use(
    createMarketFillsRouter({
      rpc: chain.rpc,
      swapRouterFor: () => SWAP_ROUTER,
      hookFor: () => null,
      insertFill: fills.insertFill,
      recordArtifacts: fills.recordArtifacts,
      // Task 062 / PF-021 — "execute user trade → activity appears".
      // C-024 leans on this table's UNIQUE (tx_hash, kind): the real
      // `recordActivity` returns the row on first insert and null on a
      // conflict, which is what makes a release exactly-once. The fake
      // reproduces that, or the replay assertion would prove nothing.
      recordActivity: (_db, input) => {
        activityEntries.push(input);
        const key = `${input.txHash ?? ""}:${input.kind}`;
        if (activityKeys.has(key)) return Promise.resolve(null);
        activityKeys.add(key);
        return Promise.resolve({
          id: key,
        } as unknown as import("../db/schema/activity.ts").Activity);
      },
      collateralFor: () => USDC,
      releaseIntent: ledger.release,
    }),
  );
  const origin = new Promise<string>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
  return { origin, ledger, chain, fills };
}

async function postJson(
  origin: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mantua-load-test": process.env.LOAD_TEST_SECRET ?? "",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const tradeBody = (direction: "buy" | "sell", amountRaw: string) => ({
  chainId: 8453,
  providerEventId: "401547401",
  outcomeIndex: 0,
  direction,
  amountRaw,
});

// ─── The journey ────────────────────────────────────────────────────────────

void describe("task 050 market trade E2E — quotes burn no headroom, one trade inks the ledger exactly once", () => {
  void it("quote ×5 → calldata → sign → verified fill → replayed fill: exactly one ledger record, at calldata issuance", async () => {
    const { origin: originP, ledger, chain, fills } = serve(100);
    const origin = await originP;

    // Stage 1 — the ticket re-quotes as the user types 10 → 25 → 40 → 60 → 80.
    for (const amountRaw of ["10000000", "25000000", "40000000", "60000000", "80000000"]) {
      const q = await postJson(origin, "/api/markets/trade/quote", tradeBody("buy", amountRaw));
      assert.equal(q.status, 200, `quote ${amountRaw}`);
      assert.equal((q.body["quote"] as { amountIn: string }).amountIn, amountRaw);
      assert.equal(q.body["data"], undefined, "a quote is not signable");
    }
    assert.deepEqual(
      ledger.calls,
      ["check:10", "check:25", "check:40", "check:60", "check:80"],
      "five quotes: five read-only checks, zero records",
    );
    assert.equal(ledger.spent(), 0, "the ledger is unchanged after repeated quotes");

    // Stage 2 — the user commits at 60 USDC: calldata is issued and the
    // intent is inked, once.
    const cd = await postJson(origin, "/api/markets/trade/calldata", tradeBody("buy", "60000000"));
    assert.equal(cd.status, 200);
    const calldata = cd.body as {
      to: `0x${string}`;
      data: `0x${string}`;
      marketId: string;
      quote: { amountIn: string; amountOut: string };
    };
    assert.equal(calldata.to, SWAP_ROUTER);
    assert.deepEqual(
      ledger.calls.slice(5),
      ["check:60", "record:60"],
      "C-019: check → issue → record",
    );
    assert.equal(ledger.spent(), 60, "one record, at issuance");

    // Stage 3 — the wallet signs and the chain mines it: to = our router,
    // from = the user.
    chain.mined.set(TX, { to: calldata.to, from: WALLET, status: "success" });

    // Stage 4 — the client reports the fill exactly as use-market-trade.ts
    // does: amounts from the calldata's own quote.
    const fillBody = {
      chainId: 8453,
      txHash: TX,
      marketId: calldata.marketId,
      direction: "buy",
      tokensRaw: calldata.quote.amountOut,
      usdcRaw: calldata.quote.amountIn,
    };
    const fill = await postJson(origin, "/api/markets/fills", fillBody);
    assert.equal(fill.status, 201);
    assert.deepEqual(fill.body, { ok: true, recorded: true });
    assert.ok(chain.reads() >= 1, "the receipt was verified on-chain");
    assert.deepEqual(fills.rows, [{ txHash: TX, usdcRaw: "60000000", direction: "buy" }]);
    assert.deepEqual(
      fills.artifacts,
      [`buy:${MARKET_ID}:60000000`],
      "tick + position mirror, once",
    );
    assert.equal(ledger.spent(), 60, "the verified fill does NOT write the ledger a second time");
    assert.equal(ledger.calls.length, 7, "no new ledger contact on the fill");

    // Stage 5 — replay the same report (double-submit / retry).
    const replay = await postJson(origin, "/api/markets/fills", fillBody);
    assert.equal(replay.status, 201, "a replay is an idempotent 201");
    assert.equal(fills.rows.length, 1, "tx_hash is unique — no second row");
    assert.equal(fills.artifacts.length, 1, "no second tick / position update");
    assert.equal(ledger.spent(), 60, "no second ledger record either");
    assert.equal(ledger.calls.length, 7);

    // The one record is the trade's USDC input — the same number the fill
    // reported and the same number the intent was checked against.
    assert.equal(Number(fills.rows[0].usdcRaw) / 1e6, ledger.spent());
    assert.equal(ledger.calls.filter((c) => c.startsWith("record:")).length, 1, "exactly once");
  });

  void it("after the trade, the ticket's next re-quote sees the spent headroom — the intent cannot be quoted or signed around", async () => {
    const { origin: originP, ledger } = serve(100);
    const origin = await originP;

    const cd = await postJson(origin, "/api/markets/trade/calldata", tradeBody("buy", "90000000"));
    assert.equal(cd.status, 200);
    assert.equal(ledger.spent(), 90);

    // A 20 USDC re-quote is over the remaining 10 — refused, no ink.
    const over = await postJson(origin, "/api/markets/trade/quote", tradeBody("buy", "20000000"));
    assert.equal(over.status, 400);
    assert.equal(over.body["code"], "spending_cap_exceeded");
    // …and so is calldata for it.
    const overCd = await postJson(
      origin,
      "/api/markets/trade/calldata",
      tradeBody("buy", "20000000"),
    );
    assert.equal(overCd.status, 400);
    assert.equal(overCd.body["code"], "spending_cap_exceeded");
    // A 10 USDC quote still fits, without spending it.
    const fits = await postJson(origin, "/api/markets/trade/quote", tradeBody("buy", "10000000"));
    assert.equal(fits.status, 200);
    assert.equal(ledger.spent(), 90, "quotes after a trade still leave the ledger unchanged");
    assert.deepEqual(ledger.calls, ["check:90", "record:90", "check:20", "check:20", "check:10"]);
  });

  void it("sells (exits) go quote → calldata → fill with zero ledger contact", async () => {
    const { origin: originP, ledger, chain, fills } = serve(0);
    const origin = await originP;

    const q = await postJson(origin, "/api/markets/trade/quote", tradeBody("sell", "8000000"));
    assert.equal(q.status, 200);
    const cd = await postJson(origin, "/api/markets/trade/calldata", tradeBody("sell", "8000000"));
    assert.equal(cd.status, 200);
    const calldata = cd.body as {
      to: `0x${string}`;
      marketId: string;
      quote: { amountIn: string; amountOut: string };
    };
    chain.mined.set(TX, { to: calldata.to, from: WALLET, status: "success" });
    const fill = await postJson(origin, "/api/markets/fills", {
      chainId: 8453,
      txHash: TX,
      marketId: calldata.marketId,
      direction: "sell",
      tokensRaw: calldata.quote.amountIn,
      usdcRaw: calldata.quote.amountOut,
    });
    assert.equal(fill.status, 201);
    assert.equal(fills.rows.length, 1);
    assert.deepEqual(ledger.calls, [], "an exit never checks or records — even with a $0 cap");
  });

  void it("a fill the chain contradicts (reverted, wrong target, unknown sender) is refused and, like every fill, writes no ledger", async () => {
    const { origin: originP, ledger, chain, fills } = serve(100);
    const origin = await originP;
    const cd = await postJson(origin, "/api/markets/trade/calldata", tradeBody("buy", "30000000"));
    assert.equal(cd.status, 200);
    const calldata = cd.body as {
      to: `0x${string}`;
      marketId: string;
      quote: { amountIn: string; amountOut: string };
    };
    const report = (txHash: string) => ({
      chainId: 8453,
      txHash,
      marketId: calldata.marketId,
      direction: "buy",
      tokensRaw: calldata.quote.amountOut,
      usdcRaw: calldata.quote.amountIn,
    });

    const reverted = `0x${"1".repeat(64)}`;
    chain.mined.set(reverted, { to: calldata.to, from: WALLET, status: "reverted" });
    const r1 = await postJson(origin, "/api/markets/fills", report(reverted));
    assert.equal(r1.status, 422);
    assert.equal(r1.body["code"], "TX_FAILED");

    const elsewhere = `0x${"2".repeat(64)}`;
    chain.mined.set(elsewhere, {
      to: "0x00000000000000000000000000000000000000ff",
      from: WALLET,
      status: "success",
    });
    const r2 = await postJson(origin, "/api/markets/fills", report(elsewhere));
    assert.equal(r2.status, 422);
    assert.equal(r2.body["code"], "WRONG_TARGET");

    const unknown = `0x${"3".repeat(64)}`;
    const r3 = await postJson(origin, "/api/markets/fills", report(unknown));
    assert.equal(r3.status, 422);
    assert.equal(r3.body["code"], "VERIFY_FAILED");

    assert.equal(fills.rows.length, 0, "nothing the chain didn't confirm is recorded");
    assert.deepEqual(
      ledger.calls,
      ["check:30", "record:30"],
      "the issuance intent stands; fills never touch the ledger",
    );
    assert.equal(ledger.spent(), 30);

    void it("task 062 / PF-021 — the verified user trade produced a market_buy activity entry", () => {
      const buys = activityEntries.filter((e) => e.kind === "market_buy");
      assert.ok(buys.length >= 1, "a fill wrote its timeline entry");
      assert.equal(buys[0]?.actor, "user");
      assert.equal(buys[0]?.status ?? "completed", "completed");
    });
  });

  /**
   * C-024 — the same journey, but the chain REVERTS the trade.
   *
   * The intent was inked at calldata issuance and no money moved, so the
   * headroom has to come back. Two things are load-bearing and both are
   * asserted here: the released amount is decoded from the bytes the wallet
   * signed (the client's inflated `usdcRaw` is ignored), and the release
   * happens exactly once however many times the failure is reported.
   */
  void it("a reverted buy releases its intent once, priced from the signed calldata not the report", async () => {
    const { origin: originP, ledger, chain, fills } = serve(100);
    const origin = await originP;

    // Commit at 60 USDC — the only ink in this journey.
    const cd = await postJson(origin, "/api/markets/trade/calldata", tradeBody("buy", "60000000"));
    assert.equal(cd.status, 200);
    const calldata = cd.body as { marketId: string };
    assert.equal(ledger.spent(), 60, "the intent is held while the tx is in flight");

    // The wallet signs our calldata; the chain mines it REVERTED.
    chain.mined.set(REVERTED_TX, {
      to: SWAP_ROUTER,
      from: WALLET,
      status: "reverted",
      input: signedSwapCalldata("buy", 60_000_000n),
    });

    // The client reports the failure and claims ten times the size.
    const failure = {
      chainId: 8453,
      txHash: REVERTED_TX,
      marketId: calldata.marketId,
      direction: "buy",
      tokensRaw: "120000000",
      usdcRaw: "600000000",
    };
    const first = await postJson(origin, "/api/markets/fills", failure);
    assert.equal(first.status, 422);
    assert.equal(first.body["code"], "TX_FAILED");
    assert.equal(first.body["intentReleased"], true);
    assert.equal(
      ledger.calls.at(-1),
      "release:60",
      "released what the signed calldata says, not the 600 the report claimed",
    );
    assert.equal(ledger.spent(), 0, "the headroom is back");
    assert.equal(fills.rows.length, 0, "a reverted trade is not a fill");

    // Replay the same failure: the activity spine's unique key blocks it.
    const replay = await postJson(origin, "/api/markets/fills", failure);
    assert.equal(replay.status, 422);
    assert.equal(replay.body["intentReleased"], false, "a replay releases nothing");
    assert.equal(ledger.spent(), 0, "and cannot drive the ledger negative");
    assert.equal(
      ledger.calls.filter((c) => c.startsWith("release:")).length,
      1,
      "exactly one release for one reverted trade",
    );
  });

  /** A reverted SELL reserved no cap, so there is nothing to give back —
   *  releasing one would mint headroom out of thin air. */
  void it("a reverted sell releases nothing", async () => {
    const { origin: originP, ledger, chain } = serve(100);
    const origin = await originP;

    const cd = await postJson(origin, "/api/markets/trade/calldata", tradeBody("buy", "40000000"));
    assert.equal(cd.status, 200);
    assert.equal(ledger.spent(), 40);

    const sellTx = `0x${"e".repeat(64)}`;
    chain.mined.set(sellTx, {
      to: SWAP_ROUTER,
      from: WALLET,
      status: "reverted",
      input: signedSwapCalldata("sell", 80_000_000n),
    });
    const res = await postJson(origin, "/api/markets/fills", {
      chainId: 8453,
      txHash: sellTx,
      marketId: MARKET_ID,
      direction: "sell",
      tokensRaw: "80000000",
      usdcRaw: "40000000",
    });
    assert.equal(res.status, 422);
    assert.equal(res.body["intentReleased"], false);
    assert.equal(ledger.spent(), 40, "the buy's intent is untouched by a reverted sell");
  });

  /** A reverted transaction to somebody else's contract must never reach the
   *  release path, whatever it claims to be. */
  void it("a reverted transaction to another contract is rejected before any release", async () => {
    const { origin: originP, ledger, chain } = serve(100);
    const origin = await originP;

    const cd = await postJson(origin, "/api/markets/trade/calldata", tradeBody("buy", "30000000"));
    assert.equal(cd.status, 200);
    assert.equal(ledger.spent(), 30);

    const foreignTx = `0x${"f".repeat(64)}`;
    chain.mined.set(foreignTx, {
      to: "0x00000000000000000000000000000000000000bb",
      from: WALLET,
      status: "reverted",
      input: signedSwapCalldata("buy", 30_000_000n),
    });
    const res = await postJson(origin, "/api/markets/fills", {
      chainId: 8453,
      txHash: foreignTx,
      marketId: MARKET_ID,
      direction: "buy",
      tokensRaw: "60000000",
      usdcRaw: "30000000",
    });
    assert.equal(res.status, 422);
    assert.equal(res.body["code"], "WRONG_TARGET", "target is checked before the receipt status");
    assert.equal(ledger.spent(), 30, "no release for a transaction that is not ours");
  });
});
