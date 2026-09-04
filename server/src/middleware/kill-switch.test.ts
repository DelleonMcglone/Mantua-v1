import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, RequestHandler, Response } from "express";
import { createKillSwitchGate } from "./kill-switch.ts";

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

function assertRefused(result: FireResult): void {
  assert.equal(result.nextCalled, false, "the request must not reach the route");
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
