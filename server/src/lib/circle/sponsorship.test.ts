import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../../env.ts";
import { V4_POOL_MANAGER } from "../v4-contracts.ts";
import { setCircleClientForTesting } from "./client.ts";
import { createAgentContractExecution } from "./execute.ts";
import {
  SponsorshipNotConfiguredError,
  assertSponsorshipConfigured,
  getGasStationPolicyId,
  sponsorshipRefId,
} from "./sponsorship.ts";

const POLICY_ID = "c4d1da72-111e-4d52-bdbf-2e74a2d803d5";

/**
 * Save/restore the env fields the sponsorship branch reads. `env` is the
 * process-wide loaded config, so tests that exercise production branches
 * mutate it for the duration of the run and restore it in `finally`.
 */
async function withSponsorshipEnv(
  overrides: { policyId?: string | null; production?: boolean },
  run: () => void | Promise<void>,
): Promise<void> {
  const { policyId = POLICY_ID, production = false } = overrides;
  const prevPolicy = env.CIRCLE_GAS_STATION_POLICY_ID;
  const prevNodeEnv = env.NODE_ENV;
  env.CIRCLE_GAS_STATION_POLICY_ID = policyId ?? undefined;
  env.NODE_ENV = production ? "production" : "test";
  try {
    await run();
  } finally {
    env.CIRCLE_GAS_STATION_POLICY_ID = prevPolicy;
    env.NODE_ENV = prevNodeEnv;
  }
}

/** Install a client stub that records every create input it is handed. */
function capturingClient(): unknown[] {
  const inputs: unknown[] = [];
  const client = {
    createContractExecutionTransaction: (input: unknown): Promise<{ data: { id: string } }> => {
      inputs.push(input);
      return Promise.resolve({ data: { id: "tx-1" } });
    },
  };
  // The stub implements the one method the execute path calls.
  setCircleClientForTesting(client as unknown as Parameters<typeof setCircleClientForTesting>[0]);
  return inputs;
}

describe("sponsorshipRefId", () => {
  it("carries the operator's policy id", async () => {
    await withSponsorshipEnv({}, () => {
      assert.equal(getGasStationPolicyId(), POLICY_ID);
      assert.equal(sponsorshipRefId(), `gas-station:${POLICY_ID}`);
    });
  });

  it("is null when no policy is recorded", async () => {
    await withSponsorshipEnv({ policyId: null }, () => {
      assert.equal(getGasStationPolicyId(), null);
      assert.equal(sponsorshipRefId(), null);
    });
  });
});

describe("createAgentContractExecution — the sponsorship call carries the policy", () => {
  it("stamps the policy id onto the calldata arm's SDK input", async () => {
    const inputs = capturingClient();
    try {
      await withSponsorshipEnv({}, async () => {
        const created = await createAgentContractExecution({
          walletId: "wallet-1",
          to: V4_POOL_MANAGER,
          callData: "0xdeadbeef",
        });
        assert.equal(created.id, "tx-1");
      });
      assert.equal(inputs.length, 1);
      assert.equal((inputs[0] as { refId?: string }).refId, `gas-station:${POLICY_ID}`);
    } finally {
      setCircleClientForTesting(null);
    }
  });

  it("stamps the policy id onto the ABI arm's SDK input", async () => {
    const inputs = capturingClient();
    try {
      await withSponsorshipEnv({}, async () => {
        await createAgentContractExecution({
          walletId: "wallet-1",
          to: V4_POOL_MANAGER,
          abiFunctionSignature: "deposit(address,uint256)",
          abiParameters: [V4_POOL_MANAGER, 1],
        });
      });
      assert.equal(inputs.length, 1);
      assert.equal((inputs[0] as { refId?: string }).refId, `gas-station:${POLICY_ID}`);
    } finally {
      setCircleClientForTesting(null);
    }
  });

  it("omits refId when no policy is recorded outside production", async () => {
    const inputs = capturingClient();
    try {
      await withSponsorshipEnv({ policyId: null }, async () => {
        await createAgentContractExecution({
          walletId: "wallet-1",
          to: V4_POOL_MANAGER,
          callData: "0xdeadbeef",
        });
      });
      assert.equal(inputs.length, 1);
      assert.equal((inputs[0] as { refId?: string }).refId, undefined);
    } finally {
      setCircleClientForTesting(null);
    }
  });

  it("refuses an unsponsored create in production", async () => {
    await withSponsorshipEnv({ policyId: null, production: true }, async () => {
      await assert.rejects(
        createAgentContractExecution({
          walletId: "wallet-1",
          to: V4_POOL_MANAGER,
          callData: "0xdeadbeef",
        }),
        SponsorshipNotConfiguredError,
      );
    });
  });
});

describe("assertSponsorshipConfigured", () => {
  it("passes outside production without a policy", async () => {
    await withSponsorshipEnv({ policyId: null }, () => {
      assert.doesNotThrow(() => {
        assertSponsorshipConfigured();
      });
    });
  });

  it("passes in production with a policy", async () => {
    await withSponsorshipEnv({ production: true }, () => {
      assert.doesNotThrow(() => {
        assertSponsorshipConfigured();
      });
    });
  });

  it("throws in production without a policy", async () => {
    await withSponsorshipEnv({ policyId: null, production: true }, () => {
      assert.throws(() => {
        assertSponsorshipConfigured();
      }, SponsorshipNotConfiguredError);
    });
  });
});
