/**
 * `CIRCLE_GAS_STATION_POLICY_ID` — a missing policy id degrades the agent,
 * it does not take the platform down.
 *
 * Owner decision 2026-09-20: this used to sit in `circleCredentialIssues`,
 * which is fatal in production, so an unset policy id refused the boot and
 * every route 500'd — markets, prices, research, support included. The real
 * guard is at transaction time (`sponsorship.ts` throws
 * `SponsorshipNotConfiguredError` rather than creating an unsponsored
 * transaction), so the boot check is now a warning and the read surface
 * stays up. The genuine deploy hazards next to it must STAY fatal.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { env, circleCredentialIssues, circleDegradations } = await import("./env.ts");

/** A fully-configured Circle credential set, for isolating one field at a time. */
const configured = {
  ...env,
  CIRCLE_API_KEY: "LIVE_API_KEY:stub:stub",
  CIRCLE_ENTITY_SECRET: "0".repeat(64),
  CIRCLE_WALLET_SET_ID: "11111111-1111-1111-1111-111111111111",
  CIRCLE_GAS_STATION_POLICY_ID: "22222222-2222-2222-2222-222222222222",
};

void describe("CIRCLE_GAS_STATION_POLICY_ID (C-017)", () => {
  void it("is a warning, never a boot-failing issue, when unset", () => {
    const unset = { ...configured, CIRCLE_GAS_STATION_POLICY_ID: undefined };
    assert.deepEqual(
      circleCredentialIssues(unset),
      [],
      "an unset policy id must not fail the production boot",
    );
    const warnings = circleDegradations(unset);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /CIRCLE_GAS_STATION_POLICY_ID is unset/);
  });

  void it("warns about nothing once the policy id is set", () => {
    assert.deepEqual(circleDegradations(configured), []);
  });

  void it("says nothing at all when Circle itself is unconfigured", () => {
    assert.deepEqual(
      circleDegradations({
        ...configured,
        CIRCLE_API_KEY: undefined,
        CIRCLE_ENTITY_SECRET: undefined,
        CIRCLE_GAS_STATION_POLICY_ID: undefined,
      }),
      [],
      "no Circle credentials means no agent to sponsor",
    );
  });

  void it("keeps the real deploy hazards fatal", () => {
    const noWalletSet = circleCredentialIssues({ ...configured, CIRCLE_WALLET_SET_ID: undefined });
    assert.equal(noWalletSet.length, 1);
    assert.match(noWalletSet[0], /CIRCLE_WALLET_SET_ID is unset/);

    const testKey = circleCredentialIssues({
      ...configured,
      CIRCLE_API_KEY: "TEST_API_KEY:stub:stub",
    });
    assert.equal(testKey.length, 1);
    assert.match(testKey[0], /TEST key/);

    const halfPair = circleCredentialIssues({ ...configured, CIRCLE_ENTITY_SECRET: undefined });
    assert.equal(halfPair.length, 1);
    assert.match(halfPair[0], /must be set together/);
  });
});
