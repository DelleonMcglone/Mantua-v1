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
