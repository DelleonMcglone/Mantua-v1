import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TargetNotAllowedError, assertAllowedTarget, isAllowedTarget } from "./allowed-targets.ts";
import { TOKENS } from "../tokens.ts";
import { HOOK_NAMES, PERMIT2, UNIVERSAL_ROUTER, getHookAddress } from "../v4-contracts.ts";

void describe("agent contract-execution allowlist (B8-006)", () => {
  void it("allows the tokens and Permit2 — case-insensitively", () => {
    assert.ok(isAllowedTarget(PERMIT2));
    assert.ok(isAllowedTarget(PERMIT2.toUpperCase().replace("0X", "0x")));
    for (const token of Object.values(TOKENS)) {
      assert.ok(isAllowedTarget(token.address), token.symbol);
    }
    for (const name of HOOK_NAMES) {
      const hook = getHookAddress(name);
      if (hook) assert.ok(isAllowedTarget(hook), name);
    }
  });

  void it("has no UniversalRouter to allow on Arc — no canonical Uniswap there (031)", () => {
    // Arc carries no canonical Uniswap deployment; the router is null and
    // nothing router-shaped is allowlisted by accident.
    assert.equal(UNIVERSAL_ROUTER, null);
    assert.equal(isAllowedTarget("0x6fF5693b99212Da76ad316178A184AB56D299b43"), false);
  });

  void it("refuses an arbitrary contract with a typed error", () => {
    const stranger = "0x000000000000000000000000000000000000dEaD";
    assert.equal(isAllowedTarget(stranger), false);
    assert.throws(() => {
      assertAllowedTarget(stranger);
    }, TargetNotAllowedError);
  });
});
