import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guardGatewaySpend } from "./unified-balance.ts";
import type { SpendGuardIo } from "./spending-cap.ts";
import { SafetyError } from "./errors.ts";


const WALLET = "0xAbC0000000000000000000000000000000000001";
const THIRD_PARTY = "0xdef0000000000000000000000000000000000002";

/**
 * C-010 — the Gateway spend path previously CHECKED the cap but never
 * recorded the spend ("a counter it never increments"), so N sequential
 * spends each passed a cap none of them consumed. These fakes keep a real
 * running ledger: `check` enforces the cap against what `record` has
 * accumulated, so the tests prove a second spend sees the first spend's
 * headroom reduction.
 */
function makeLedgerIo(capUsd: number): { io: SpendGuardIo; calls: string[] } {
  const calls: string[] = [];
  let spent = 0;
  const io: SpendGuardIo = {
    check: (_address, usd) => {
      calls.push(`check:${String(usd)}`);
      if (spent + usd > capUsd) {
        return Promise.reject(
          new SafetyError("spending_cap_exceeded", `Daily cap $${String(capUsd)} exceeded`, {
            cap: capUsd,
            spent,
            usdAmount: usd,
          }),
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
  return { io, calls };
}

void describe("guardGatewaySpend (C-010 Gateway cap recording)", () => {
  void it("records a third-party spend so the SECOND spend sees reduced headroom", async () => {
    const { io, calls } = makeLedgerIo(100);
    const issue = (): Promise<string> => Promise.resolve("burn-1");

    // First spend of 60: fits under the $100 cap, and must be RECORDED.
    assert.equal(await guardGatewaySpend(WALLET, THIRD_PARTY, "60", issue, io), "burn-1");
    assert.deepEqual(calls, ["check:60", "record:60"]);

    // Second spend of 60: only $40 headroom remains — the first spend's
    // record must make this check fail (pre-fix, both would have passed).
    await assert.rejects(
      guardGatewaySpend(WALLET, THIRD_PARTY, "60", issue, io),
      (err: unknown) => err instanceof SafetyError && err.code === "spending_cap_exceeded",
    );
    assert.deepEqual(calls, ["check:60", "record:60", "check:60"], "blocked spend leaves no ink");
  });

  void it("runs check, then issue, then record — a failed issue leaves no ink", async () => {
    const { io, calls } = makeLedgerIo(100);
    await assert.rejects(
      guardGatewaySpend(WALLET, THIRD_PARTY, "10", () => {
        calls.push("issue");
        return Promise.reject(new Error("gateway down"));
      }, io),
      /gateway down/,
    );
    assert.deepEqual(calls, ["check:10", "issue"], "record must not run after a failed issue");
  });

  void it("bypasses check and record for self-recipient treasury moves (case-insensitive)", async () => {
    const { io, calls } = makeLedgerIo(1);
    const result = await guardGatewaySpend(
      WALLET,
      WALLET.toUpperCase().replace("0X", "0x"),
      "999999", // far over cap — must not matter for a self-transfer
      () => Promise.resolve("treasury-move"),
      io,
    );
    assert.equal(result, "treasury-move");
    assert.deepEqual(calls, [], "self-recipient spends never touch the cap ledger");
  });

  void it("fails closed on an unpriceable amount — no check, no issue, no record", async () => {
    const { io, calls } = makeLedgerIo(100);
    let issued = false;
    await assert.rejects(
      guardGatewaySpend(WALLET, THIRD_PARTY, "not-a-number", () => {
        issued = true;
        return Promise.resolve("burn");
      }, io),
      /Invalid Gateway spend amount/,
    );
    assert.equal(issued, false);
    assert.deepEqual(calls, []);
  });
});

/**
 * C-008 closeout — read-path tests for the unified USDC balance service's
 * pure helpers. The consolidated balance itself is shaped inside
 * `getUnifiedBalances` (SDK-bound, exercised end-to-end via the Portfolio
 * trace in docs/tasks/026-x402-unified-balance-closeout.md); what IS pure and
 * exported here is the Gateway destination-chain vocabulary the spend
 * read-path (route schema + agent tool) validates against.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { GATEWAY_SPEND_CHAINS, isGatewaySpendChain, resolveGatewaySpendChain } = await import(
  "./unified-balance.ts"
);

void describe("gateway spend-chain vocabulary", () => {
  void it("lists the five mainnet destinations, Base (the home chain) excluded", () => {
    assert.deepEqual(
      [...GATEWAY_SPEND_CHAINS],
      ["Ethereum", "Avalanche", "Optimism", "Arbitrum", "Polygon"],
    );
    assert.equal(
      (GATEWAY_SPEND_CHAINS as readonly string[]).includes("Base"),
      false,
      "deposits live on Base — it is never a spend destination",
    );
  });

  void it("isGatewaySpendChain accepts exactly the canonical names", () => {
    for (const chain of GATEWAY_SPEND_CHAINS) assert.equal(isGatewaySpendChain(chain), true);
    assert.equal(isGatewaySpendChain("ethereum"), false, "case-sensitive by design");
    assert.equal(isGatewaySpendChain("Base"), false);
    assert.equal(isGatewaySpendChain(""), false);
    assert.equal(isGatewaySpendChain(42), false);
    assert.equal(isGatewaySpendChain(null), false);
  });
});

void describe("resolveGatewaySpendChain (typed-command fuzzy matching)", () => {
  void it("passes canonical names through unchanged", () => {
    for (const chain of GATEWAY_SPEND_CHAINS) {
      assert.equal(resolveGatewaySpendChain(chain), chain);
    }
  });

  void it("resolves common aliases and tickers", () => {
    assert.equal(resolveGatewaySpendChain("ethereum"), "Ethereum");
    assert.equal(resolveGatewaySpendChain("eth"), "Ethereum");
    assert.equal(resolveGatewaySpendChain("ETH"), "Ethereum");
    assert.equal(resolveGatewaySpendChain("avax"), "Avalanche");
    assert.equal(resolveGatewaySpendChain("op"), "Optimism");
    assert.equal(resolveGatewaySpendChain("arb"), "Arbitrum");
    assert.equal(resolveGatewaySpendChain("matic"), "Polygon");
  });

  void it("strips separators and mainnet/one suffixes the way users type them", () => {
    assert.equal(resolveGatewaySpendChain("OP Mainnet"), "Optimism");
    assert.equal(resolveGatewaySpendChain("arbitrum one"), "Arbitrum");
    assert.equal(resolveGatewaySpendChain("Arbitrum_One"), "Arbitrum");
    assert.equal(resolveGatewaySpendChain("polygon-mainnet"), "Polygon");
    assert.equal(resolveGatewaySpendChain("  Avalanche  ".trim()), "Avalanche");
  });

  void it("returns null for non-destinations instead of guessing", () => {
    assert.equal(resolveGatewaySpendChain("Base"), null, "home chain is not a destination");
    assert.equal(resolveGatewaySpendChain("base"), null);
    assert.equal(resolveGatewaySpendChain("solana"), null);
    assert.equal(resolveGatewaySpendChain("dogechain"), null);
    assert.equal(resolveGatewaySpendChain(""), null);
  });
});
