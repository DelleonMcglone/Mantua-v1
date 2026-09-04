import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { guardSpend, type SpendGuardIo } from "./spending-cap.ts";

const WALLET = "0xabc0000000000000000000000000000000000001";

/**
 * C-019 — the money-moving sequence is: price the spend, check the cap,
 * issue the trade, record the intent. These fakes log every call so each
 * test asserts the exact ordering and what happens when a step fails.
 */
function makeIo(overrides: Partial<SpendGuardIo> = {}): { io: SpendGuardIo; calls: string[] } {
  const calls: string[] = [];
  const io: SpendGuardIo = {
    check: (address, usd) => {
      calls.push(`check:${address}:${String(usd)}`);
      return overrides.check ? overrides.check(address, usd) : Promise.resolve();
    },
    record: (address, usd) => {
      calls.push(`record:${address}:${String(usd)}`);
      return overrides.record ? overrides.record(address, usd) : Promise.resolve();
    },
  };
  return { io, calls };
}

describe("guardSpend (C-019 calldata cap sequence)", () => {
  it("prices, then checks, then issues, then records — in that order", async () => {
    const { io, calls } = makeIo();
    const issued = await guardSpend(
      () => Promise.resolve(12.5),
      WALLET,
      (usd) => {
        calls.push(`issue:${String(usd)}`);
        return Promise.resolve("calldata");
      },
      io,
    );
    assert.equal(issued, "calldata");
    assert.deepEqual(calls, [`check:${WALLET}:12.5`, "issue:12.5", `record:${WALLET}:12.5`]);
  });

  it("issues nothing when the cap check rejects (SafetyError path)", async () => {
    const { io, calls } = makeIo({
      check: () => {
        throw new Error("spending_cap_exceeded");
      },
    });
    await assert.rejects(
      guardSpend(
        () => Promise.resolve(50),
        WALLET,
        () => {
          calls.push("issue");
          return Promise.resolve("calldata");
        },
        io,
      ),
      /spending_cap_exceeded/,
    );
    assert.deepEqual(calls, [`check:${WALLET}:50`], "no issuance, no ledger ink after a cap block");
  });

  it("records nothing when issuance fails (no ink for undelivered calldata)", async () => {
    const { io, calls } = makeIo();
    await assert.rejects(
      guardSpend(
        () => Promise.resolve(5),
        WALLET,
        () => {
          calls.push("issue");
          return Promise.reject(new Error("upstream down"));
        },
        io,
      ),
      /upstream down/,
    );
    assert.deepEqual(
      calls,
      [`check:${WALLET}:5`, "issue"],
      "record must not run after a failed issue",
    );
  });

  it("touches nothing when pricing itself fails (the fail-closed seam)", async () => {
    const { io, calls } = makeIo();
    await assert.rejects(
      guardSpend(
        () => Promise.reject(new Error("PriceUnavailableError: no feed")),
        WALLET,
        () => {
          calls.push("issue");
          return Promise.resolve("calldata");
        },
        io,
      ),
      /no feed/,
    );
    assert.deepEqual(calls, [], "no price, no check, no issue, no record");
  });
});
