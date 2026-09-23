import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import type { FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  createGuardedPaywall,
  RETRY_AFTER_MS,
  type GuardedPaywallState,
} from "./guarded-paywall.ts";

/**
 * createGuardedPaywall — the facilitator handshake that runs at module load
 * must settle into a state, never reject unhandled (the 2026-09-23 prod
 * incident: x402.org rejected "exact" on eip155:8453 and every function that
 * imported the app logged an unhandled rejection).
 */

const PATH = "/api/x402/test";
const NETWORK = "eip155:8453";

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};
process.on("unhandledRejection", onUnhandled);
after(() => {
  process.off("unhandledRejection", onUnhandled);
});

function facilitator(getSupported: () => Promise<unknown>): FacilitatorClient & { calls: number } {
  const f = {
    calls: 0,
    getSupported: () => {
      f.calls++;
      return getSupported();
    },
    verify: () => Promise.reject(new Error("unused")),
    settle: () => Promise.reject(new Error("unused")),
  };
  return f as unknown as FacilitatorClient & { calls: number };
}

const supports = (network: string) => () =>
  Promise.resolve({
    kinds: [{ x402Version: 2, scheme: "exact", network }],
    extensions: [],
    signers: {},
  });

function build(fac: FacilitatorClient, now?: () => number) {
  const refused: GuardedPaywallState[] = [];
  const paywall = createGuardedPaywall({
    label: "test",
    routes: {
      [PATH]: {
        accepts: {
          scheme: "exact",
          payTo: `0x${"1".repeat(40)}`,
          price: "$0.01",
          network: NETWORK,
        },
      },
    },
    facilitator: fac,
    schemes: [{ network: NETWORK, server: new ExactEvmScheme() }],
    onUnavailable: (_res, state) => refused.push(state),
    ...(now ? { now } : {}),
  });
  /** Drive one request through the handler and wait for it to settle. */
  const hit = async (): Promise<void> => {
    paywall.handler({} as never, {} as Response, () => undefined);
    await paywall.ready;
    await new Promise((r) => setImmediate(r));
  };
  return { paywall, refused, hit };
}

void describe("createGuardedPaywall", () => {
  void it("settles 'unsupported' (not a rejection) when the facilitator lacks the network", async () => {
    const { paywall, refused, hit } = build(facilitator(supports("eip155:84532")));
    assert.equal(await paywall.ready, "unsupported");
    await hit();
    assert.deepEqual(refused, ["unsupported"]);
    assert.deepEqual(unhandled, []);
  });

  void it("settles 'ready' when the facilitator serves the route's scheme/network", async () => {
    const { paywall } = build(facilitator(supports(NETWORK)));
    assert.equal(await paywall.ready, "ready");
    assert.equal(paywall.state(), "ready");
  });

  void it("retries a transient handshake failure only after the cooldown", async () => {
    let clock = 0;
    let fail = true;
    const fac = facilitator(() =>
      fail ? Promise.reject(new Error("ECONNRESET")) : supports(NETWORK)(),
    );
    const { paywall, refused, hit } = build(fac, () => clock);
    assert.equal(await paywall.ready, "unavailable");

    fail = false;
    await hit(); // inside the cooldown — no new handshake
    assert.equal(fac.calls, 1);
    assert.deepEqual(refused, ["unavailable"]);

    clock = RETRY_AFTER_MS;
    paywall.handler({} as never, {} as Response, () => undefined);
    assert.equal(await paywall.ready, "ready");
    assert.equal(fac.calls, 2);
    assert.deepEqual(unhandled, []);
  });
});
