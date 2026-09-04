import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planMintApprovals,
  type MintAllowanceState,
  type PlannedMintApproval,
} from "./agent-liquidity.ts";
import { PERMIT2 } from "./v4-contracts.ts";

const TOKEN = "0x0000000000000000000000000000000000000abc" as const;
const POSITION_MANAGER = "0x0000000000000000000000000000000000000def" as const;
const NOW = 1_800_000_000;

// The maximums the old max-grant code approved — bounded grants must stay far
// below these (D-110).
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;

/** 1,000 tokens at 6 decimals with a 1% slippage buffer — the mint's max pull. */
const REQUIRED_RAW = 1_010_000_000n;

function state(over: Partial<MintAllowanceState> = {}): MintAllowanceState {
  return { erc20Allowance: 0n, permit2Allowance: 0n, permit2Expiration: 0, ...over };
}

/** Read a numeric approve param as a bigint. */
function amountParam(call: PlannedMintApproval, index: number): bigint {
  return BigInt(call.abiParameters[index]);
}

void describe("planMintApprovals", () => {
  void it("approves exactly the requested trade size, never a max allowance", () => {
    const calls = planMintApprovals({
      token: TOKEN,
      positionManager: POSITION_MANAGER,
      requiredRaw: REQUIRED_RAW,
      state: state(),
      nowSeconds: NOW,
    });

    assert.equal(calls.length, 2);
    const [erc20Call, permit2Call] = calls;

    // ERC20 → Permit2 approval: the trade's max pull, not MAX_UINT256.
    assert.equal(erc20Call.to, TOKEN);
    assert.equal(erc20Call.abiFunctionSignature, "approve(address,uint256)");
    assert.equal(amountParam(erc20Call, 1), REQUIRED_RAW);
    assert.ok(amountParam(erc20Call, 1) < MAX_UINT256);

    // Permit2 → PositionManager allowance: the trade's max pull, bounded expiry.
    assert.equal(permit2Call.to, PERMIT2);
    assert.equal(permit2Call.abiFunctionSignature, "approve(address,address,uint160,uint48)");
    assert.equal(amountParam(permit2Call, 2), REQUIRED_RAW);
    assert.ok(amountParam(permit2Call, 2) < MAX_UINT160);
    assert.equal(amountParam(permit2Call, 3), BigInt(NOW + 3600));
    assert.ok(amountParam(permit2Call, 3) < MAX_UINT48);
  });

  void it("reuses allowances that already cover the mint", () => {
    const calls = planMintApprovals({
      token: TOKEN,
      positionManager: POSITION_MANAGER,
      requiredRaw: REQUIRED_RAW,
      state: state({
        // Exactly the requirement is sufficient — the mint can never pull more.
        erc20Allowance: REQUIRED_RAW,
        permit2Allowance: REQUIRED_RAW,
        permit2Expiration: NOW + 3601,
      }),
      nowSeconds: NOW,
    });
    assert.deepEqual(calls, []);
  });

  void it("tops up only the side that falls short", () => {
    const covered: MintAllowanceState = {
      erc20Allowance: REQUIRED_RAW,
      permit2Allowance: REQUIRED_RAW,
      permit2Expiration: NOW + 3601,
    };

    const erc20Short = planMintApprovals({
      token: TOKEN,
      positionManager: POSITION_MANAGER,
      requiredRaw: REQUIRED_RAW,
      state: { ...covered, erc20Allowance: REQUIRED_RAW - 1n },
      nowSeconds: NOW,
    });
    assert.equal(erc20Short.length, 1);
    assert.equal(erc20Short[0].to, TOKEN);
    assert.equal(amountParam(erc20Short[0], 1), REQUIRED_RAW);

    const permit2Short = planMintApprovals({
      token: TOKEN,
      positionManager: POSITION_MANAGER,
      requiredRaw: REQUIRED_RAW,
      state: { ...covered, permit2Allowance: REQUIRED_RAW - 1n },
      nowSeconds: NOW,
    });
    assert.equal(permit2Short.length, 1);
    assert.equal(permit2Short[0].to, PERMIT2);
    assert.equal(amountParam(permit2Short[0], 2), REQUIRED_RAW);
  });

  void it("re-grants a Permit2 allowance that expires too soon, with a bounded expiry", () => {
    const base: MintAllowanceState = {
      erc20Allowance: REQUIRED_RAW,
      permit2Allowance: REQUIRED_RAW,
      permit2Expiration: NOW + 600, // exactly at the validity buffer → stale
    };
    const calls = planMintApprovals({
      token: TOKEN,
      positionManager: POSITION_MANAGER,
      requiredRaw: REQUIRED_RAW,
      state: base,
      nowSeconds: NOW,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, PERMIT2);
    assert.equal(amountParam(calls[0], 2), REQUIRED_RAW);
    assert.equal(amountParam(calls[0], 3), BigInt(NOW + 3600));

    // One second outside the buffer → still fresh, no re-grant.
    const stillFresh = planMintApprovals({
      token: TOKEN,
      positionManager: POSITION_MANAGER,
      requiredRaw: REQUIRED_RAW,
      state: { ...base, permit2Expiration: NOW + 601 },
      nowSeconds: NOW,
    });
    assert.deepEqual(stillFresh, []);
  });
});
