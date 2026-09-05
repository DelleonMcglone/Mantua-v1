import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TargetNotAllowedError, assertAllowedTarget, isAllowedTarget } from "./allowed-targets.ts";
import { TOKENS } from "../tokens.ts";
import {
  HOOK_NAMES,
  PERMIT2,
  UNIVERSAL_ROUTER,
  V4_POOL_MANAGER,
  getHookAddress,
} from "../v4-contracts.ts";

void describe("agent contract-execution allowlist (B8-006)", () => {
  void it("allows the v4 stack, tokens, and Permit2 — case-insensitively", () => {
    assert.ok(isAllowedTarget(V4_POOL_MANAGER));
    assert.ok(isAllowedTarget(V4_POOL_MANAGER.toUpperCase().replace("0X", "0x")));
    assert.ok(isAllowedTarget(PERMIT2));
    for (const token of Object.values(TOKENS)) {
      assert.ok(isAllowedTarget(token.address), token.symbol);
    }
    for (const name of HOOK_NAMES) {
      const hook = getHookAddress(name);
      if (hook) assert.ok(isAllowedTarget(hook), name);
    }
  });

  void it("allows the UniversalRouter — the agent swap execution target (031)", () => {
    assert.ok(isAllowedTarget(UNIVERSAL_ROUTER));
    assert.ok(isAllowedTarget(UNIVERSAL_ROUTER.toUpperCase().replace("0X", "0x")));
  });

  void it("refuses an arbitrary contract with a typed error", () => {
    const stranger = "0x000000000000000000000000000000000000dEaD";
    assert.equal(isAllowedTarget(stranger), false);
    assert.throws(() => {
      assertAllowedTarget(stranger);
    }, TargetNotAllowedError);
  });
});
