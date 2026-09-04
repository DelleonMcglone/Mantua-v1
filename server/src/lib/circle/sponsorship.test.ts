import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../../env.ts";
import { V4_POOL_MANAGER } from "../v4-contracts.ts";
import { setCircleClientForTesting } from "./client.ts";
import {
  CircleReceiptTimeoutError,
  CircleTransactionFailedError,
  createAgentContractExecution,
  executeAgentCalldata,
} from "./execute.ts";
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

const HASH = `0x${"ab".repeat(32)}`;

/**
 * Client stub for the FULL executeAgent path (create + receipt poll): each
 * create mints a distinct tx id, and `getTransaction` reports the given
 * terminal state for every transaction.
 */
function capturingClientWithReceipt(
  state: "CONFIRMED" | "COMPLETE" | "FAILED" | "CANCELLED" | "DENIED" | "SENT",
  errorReason: string | null = null,
): { inputs: Record<string, unknown>[] } {
  const inputs: Record<string, unknown>[] = [];
  const client = {
    createContractExecutionTransaction: (
      input: Record<string, unknown>,
    ): Promise<{ data: { id: string } }> => {
      inputs.push(input);
      return Promise.resolve({ data: { id: `tx-${String(inputs.length)}` } });
    },
    getTransaction: (): Promise<{
      data: { transaction: { state: string; txHash: string; errorReason: string | null } };
    }> => Promise.resolve({ data: { transaction: { state, txHash: HASH, errorReason } } }),
  };
  setCircleClientForTesting(client as unknown as Parameters<typeof setCircleClientForTesting>[0]);
  return { inputs };
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

  it("refuses an unsponsored create in production — before Circle is ever called", async () => {
    const inputs = capturingClient();
    try {
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
      // The refusal is a guard, not an API error: the SDK was never invoked.
      assert.equal(inputs.length, 0);
    } finally {
      setCircleClientForTesting(null);
    }
  });

  it("refuses an unsponsored ABI-arm create in production too", async () => {
    const inputs = capturingClient();
    try {
      await withSponsorshipEnv({ policyId: null, production: true }, async () => {
        await assert.rejects(
          createAgentContractExecution({
            walletId: "wallet-1",
            to: V4_POOL_MANAGER,
            abiFunctionSignature: "transfer(address,uint256)",
            abiParameters: [V4_POOL_MANAGER, 0],
          }),
          SponsorshipNotConfiguredError,
        );
      });
      assert.equal(inputs.length, 0);
    } finally {
      setCircleClientForTesting(null);
    }
  });
});

describe("executeAgentCalldata — sponsored full path (create → receipt)", () => {
  it("propagates the sponsorship ref and resolves only on the confirmed receipt", async () => {
    const { inputs } = capturingClientWithReceipt("CONFIRMED");
    try {
      await withSponsorshipEnv({}, async () => {
        const result = await executeAgentCalldata({
          walletId: "wallet-1",
          to: V4_POOL_MANAGER,
          callData: "0xdeadbeef",
        });
        assert.equal(result.state, "CONFIRMED");
        assert.equal(result.txHash, HASH);
      });
      assert.equal(inputs.length, 1);
      assert.equal(inputs[0].refId, `gas-station:${POLICY_ID}`);
    } finally {
      setCircleClientForTesting(null);
    }
  });

  it("surfaces a DENIED terminal state as a typed failure, never a success", async () => {
    const { inputs } = capturingClientWithReceipt("DENIED", "denied by screening");
    try {
      await withSponsorshipEnv({}, async () => {
        try {
          await executeAgentCalldata({
            walletId: "wallet-1",
            to: V4_POOL_MANAGER,
            callData: "0xdeadbeef",
          });
          assert.fail("expected CircleTransactionFailedError");
        } catch (err) {
          assert.ok(err instanceof CircleTransactionFailedError);
          assert.equal(err.state, "DENIED");
          assert.equal(err.errorReason, "denied by screening");
          // The failure is NOT the indeterminate outcome — callers can
          // branch on the type to reverse provisional ledger state.
          assert.ok(!(err instanceof CircleReceiptTimeoutError));
        }
      });
      // The create itself succeeded and was sponsored — the failure came
      // from the terminal state, with the refId already stamped.
      assert.equal(inputs.length, 1);
      assert.equal(inputs[0].refId, `gas-station:${POLICY_ID}`);
    } finally {
      setCircleClientForTesting(null);
    }
  });
});

describe("createAgentContractExecution — high-volume concurrency", () => {
  it("a burst of concurrent creates each independently carries the sponsorship ref", async () => {
    const BURST = 25;
    const inputs = capturingClient();
    try {
      await withSponsorshipEnv({}, async () => {
        await Promise.all(
          Array.from({ length: BURST }, (_, i) =>
            createAgentContractExecution({
              walletId: `wallet-${String(i)}`,
              to: V4_POOL_MANAGER,
              callData: "0xdeadbeef",
            }),
          ),
        );
      });
      assert.equal(inputs.length, BURST);
      const typed = inputs as { refId?: string; idempotencyKey?: string; walletId?: string }[];
      // Every create carries the ref — no request lost it to shared state.
      for (const input of typed) {
        assert.equal(input.refId, `gas-station:${POLICY_ID}`);
      }
      // No cross-request bleed: idempotency keys are all distinct (a shared
      // or reused key would collapse concurrent transactions into one), and
      // every wallet id arrived unmangled.
      assert.equal(new Set(typed.map((i) => i.idempotencyKey)).size, BURST);
      assert.equal(new Set(typed.map((i) => i.walletId)).size, BURST);
    } finally {
      setCircleClientForTesting(null);
    }
  });

  it("a concurrent burst still refuses every create when unsponsored in production", async () => {
    const inputs = capturingClient();
    try {
      await withSponsorshipEnv({ policyId: null, production: true }, async () => {
        const results = await Promise.allSettled(
          Array.from({ length: 10 }, (_, i) =>
            createAgentContractExecution({
              walletId: `wallet-${String(i)}`,
              to: V4_POOL_MANAGER,
              callData: "0xdeadbeef",
            }),
          ),
        );
        for (const result of results) {
          // @types/node's assert.equal narrows `result` via the discriminant.
          assert.equal(result.status, "rejected");
          assert.ok(result.reason instanceof SponsorshipNotConfiguredError);
        }
      });
      assert.equal(inputs.length, 0);
    } finally {
      setCircleClientForTesting(null);
    }
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
