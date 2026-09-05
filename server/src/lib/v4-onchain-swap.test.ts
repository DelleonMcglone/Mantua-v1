/**
 * 031 — hook resolution fails CLOSED.
 *
 * `resolveHookAddress` used to substitute the zero (no-hook) address when
 * a named hook had no deployment — so a user who selected the Stable
 * Protection venue would silently quote (and swap) the unprotected
 * no-hook pool. It now throws `HookNotDeployedError` for any named hook
 * without a live address; only `hook = null` maps to the no-hook pool.
 *
 * The suite adapts to the environment: with no hook address configured
 * (the current mainnet state) it pins the fail-closed throw; when an env
 * override supplies an address it pins the pass-through.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_CHAIN_ID } from "./chains.ts";
import { getHookAddress, HOOK_NAMES } from "./v4-contracts.ts";
import { HookNotDeployedError, resolveHookAddress } from "./v4-onchain-swap.ts";

const ZERO = "0x0000000000000000000000000000000000000000";

void describe("resolveHookAddress — fail closed on undeployed hooks", () => {
  void it("null hook → the zero (no-hook) address", () => {
    assert.equal(resolveHookAddress(null, BASE_CHAIN_ID), ZERO);
  });

  void it("a named hook never silently degrades to the no-hook pool", () => {
    for (const name of HOOK_NAMES) {
      const deployed = getHookAddress(name, BASE_CHAIN_ID);
      if (deployed === null) {
        assert.throws(
          () => resolveHookAddress(name, BASE_CHAIN_ID),
          HookNotDeployedError,
          `${name} has no deployment and must throw`,
        );
      } else {
        assert.equal(resolveHookAddress(name, BASE_CHAIN_ID), deployed, name);
        assert.notEqual(deployed, ZERO, name);
      }
    }
  });

  void it("an unknown hook name is refused, not treated as no-hook", () => {
    assert.throws(
      () =>
        resolveHookAddress(
          "not-a-real-hook" as unknown as (typeof HOOK_NAMES)[number],
          BASE_CHAIN_ID,
        ),
      HookNotDeployedError,
    );
  });
});
