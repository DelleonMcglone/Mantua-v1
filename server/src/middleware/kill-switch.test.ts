import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, RequestHandler, Response } from "express";
import {
  createKillSwitchGate,
  createRuntimeKillSwitchFlag,
  KILL_SWITCH_READ_SCRIPT,
} from "./kill-switch.ts";

/**
 * The three Vercel-cron money loops (C-020). Each is GET-routed, so the
 * pre-C-020 write-method gate never stopped them; one refusal test per path
 * proves the gate now covers every money cron while engaged.
 */
const MONEY_CRON_PATHS = [
  "/api/cron/rebalance",
  "/api/cron/intents",
  "/api/cron/strategies",
] as const;

interface FireResult {
  nextCalled: boolean;
  status: number | undefined;
  body: unknown;
}

/** Drive one request through the real middleware with a minimal req/res. */
function fire(handler: RequestHandler, method: string, path: string): Promise<FireResult> {
  return new Promise((resolve) => {
    let settled = false;
    let status: number | undefined;
    let body: unknown;
    const done = (nextCalled: boolean): void => {
      if (!settled) {
        settled = true;
        resolve({ nextCalled, status, body });
      }
    };
    const res = {
      status(code: number) {
        status = code;
        return res;
      },
      json(payload: unknown) {
        body = payload;
        done(false);
        return res;
      },
    } as unknown as Response;
    handler({ method, path } as unknown as Request, res, () => {
      done(true);
    });
  });
}

function assertRefused(result: FireResult, message?: string): void {
  assert.equal(result.nextCalled, false, message ?? "the request must not reach the route");
  assert.equal(result.status, 503);
  assert.equal((result.body as { code?: string }).code, "KILL_SWITCH_ACTIVE");
}

void describe("kill switch — cron money-path coverage (C-020)", () => {
  for (const path of MONEY_CRON_PATHS) {
    void it(`refuses GET ${path} while engaged`, async () => {
      const gate = createKillSwitchGate({ envEngaged: true });
      assertRefused(await fire(gate, "GET", path));
    });
  }

  void it("refuses the money crons spelled with a trailing slash too", async () => {
    const gate = createKillSwitchGate({ envEngaged: true });
    assertRefused(await fire(gate, "GET", "/api/cron/rebalance/"));
  });

  void it("keeps the read-only crons and other GETs up while engaged", async () => {
    const gate = createKillSwitchGate({ envEngaged: true });
    for (const path of ["/api/cron/peg-sync", "/api/cron/resolution", "/api/health"]) {
      const result = await fire(gate, "GET", path);
      assert.equal(result.nextCalled, true, `${path} is not a money path and must pass`);
    }
  });

  void it("still refuses writes while engaged", async () => {
    const gate = createKillSwitchGate({ envEngaged: true });
    assertRefused(await fire(gate, "POST", "/api/swap"));
  });

  void it("gates nothing while disengaged", async () => {
    const gate = createKillSwitchGate({ envEngaged: false });
    const write = await fire(gate, "POST", "/api/swap");
    assert.equal(write.nextCalled, true, "writes pass while disengaged");
    const cron = await fire(gate, "GET", "/api/cron/rebalance");
    assert.equal(cron.nextCalled, true, "money crons pass while disengaged");
  });
});

/**
 * In-memory stand-in for the operator-side Upstash console: the flag key's
 * current value (or absence), plus a fault switch for outage tests. `eval`
 * dispatches on the exact script constant so a changed script fails loudly.
 */
class FakeFlagStore {
  private value: string | null = null;
  private failure: Error | undefined;

  setFlag(value: string): void {
    this.value = value;
  }

  clearFlag(): void {
    this.value = null;
  }

  failReadsWith(error: Error): void {
    this.failure = error;
  }

  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    if (script !== KILL_SWITCH_READ_SCRIPT) {
      return Promise.reject(
        new Error(`FakeFlagStore does not implement script: ${script.slice(0, 32)}`),
      );
    }
    void keys;
    void args;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.value);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

void describe("kill switch — runtime toggle over the shared store (C-020)", () => {
  void it("the toggle takes effect without a redeploy", async () => {
    const store = new FakeFlagStore();
    // One gate instance for the whole test — no re-import, no env change,
    // no restart. Only the value in the shared store moves.
    const gate = createKillSwitchGate({
      envEngaged: false,
      runtime: createRuntimeKillSwitchFlag({ client: store, cacheTtlMs: 0 }),
    });

    const before = await fire(gate, "GET", "/api/cron/rebalance");
    assert.equal(before.nextCalled, true, "no flag: the money cron runs");

    store.setFlag("1"); // the operator's console action
    assertRefused(await fire(gate, "GET", "/api/cron/rebalance"));

    store.clearFlag();
    const after = await fire(gate, "GET", "/api/cron/rebalance");
    assert.equal(after.nextCalled, true, "clearing the flag resumes the cron");
  });

  void it("a runtime engagement refuses all three money crons", async () => {
    const store = new FakeFlagStore();
    store.setFlag("1");
    const gate = createKillSwitchGate({
      envEngaged: false,
      runtime: createRuntimeKillSwitchFlag({ client: store, cacheTtlMs: 0 }),
    });
    for (const path of MONEY_CRON_PATHS) {
      assertRefused(await fire(gate, "GET", path));
    }
  });

  void it("a runtime engagement keeps read-only GETs up", async () => {
    const store = new FakeFlagStore();
    store.setFlag("1");
    const gate = createKillSwitchGate({
      envEngaged: false,
      runtime: createRuntimeKillSwitchFlag({ client: store, cacheTtlMs: 0 }),
    });
    const result = await fire(gate, "GET", "/api/health");
    assert.equal(result.nextCalled, true, "reads stay up during a runtime engagement");
  });

  void it("caches the flag for the TTL window before re-reading", async () => {
    const store = new FakeFlagStore();
    const gate = createKillSwitchGate({
      envEngaged: false,
      runtime: createRuntimeKillSwitchFlag({ client: store, cacheTtlMs: 25 }),
    });

    const first = await fire(gate, "GET", "/api/cron/rebalance");
    assert.equal(first.nextCalled, true, "starts disengaged");

    store.setFlag("1");
    const cached = await fire(gate, "GET", "/api/cron/rebalance");
    assert.equal(cached.nextCalled, true, "engagement inside the cache window is not seen yet");

    await sleep(60);
    assertRefused(await fire(gate, "GET", "/api/cron/rebalance"));
  });

  void it("a Redis outage keeps the last known engagement (never silently un-kills)", async () => {
    const store = new FakeFlagStore();
    store.setFlag("1");
    const gate = createKillSwitchGate({
      envEngaged: false,
      runtime: createRuntimeKillSwitchFlag({ client: store, cacheTtlMs: 0 }),
    });
    assertRefused(await fire(gate, "GET", "/api/cron/rebalance")); // establishes engaged

    store.failReadsWith(new Error("upstash unreachable"));
    assertRefused(
      await fire(gate, "GET", "/api/cron/rebalance"),
      "the outage must not lift the engagement",
    );
  });

  void it("a Redis outage with no prior read fails open for availability", async () => {
    const store = new FakeFlagStore();
    store.failReadsWith(new Error("upstash unreachable"));
    const gate = createKillSwitchGate({
      envEngaged: false,
      runtime: createRuntimeKillSwitchFlag({ client: store, cacheTtlMs: 0 }),
    });
    const result = await fire(gate, "GET", "/api/cron/rebalance");
    assert.equal(result.nextCalled, true, "an outage must not take the API down");
  });

  void it("a mangled flag value fails safe (treated as engaged)", async () => {
    const store = new FakeFlagStore();
    store.setFlag("true");
    const gate = createKillSwitchGate({
      envEngaged: false,
      runtime: createRuntimeKillSwitchFlag({ client: store, cacheTtlMs: 0 }),
    });
    assertRefused(await fire(gate, "GET", "/api/cron/rebalance"));
  });

  void it("without Redis configured the switch is deploy-time only — and still covers the crons", async () => {
    const gate = createKillSwitchGate({ envEngaged: true, runtime: undefined });
    assertRefused(await fire(gate, "POST", "/api/swap"));
    assertRefused(await fire(gate, "GET", "/api/cron/rebalance"));
  });
});
