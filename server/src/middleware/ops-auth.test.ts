import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { opsAuthGuard } from "./ops-auth-core.ts";

/** Task 073 — the operator guard: disabled when unset, bearer-key otherwise. */

function run(key: string | undefined, authorization: string | undefined) {
  const out: { status: number | null; body: unknown; next: boolean; rejected: number } = {
    status: null,
    body: null,
    next: false,
    rejected: 0,
  };
  const req = { get: (name: string) => (name === "authorization" ? authorization : undefined) };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  const guard = opsAuthGuard(
    () => key,
    () => {
      out.rejected += 1;
    },
  );
  guard(req as unknown as Request, res as unknown as Response, () => {
    out.next = true;
  });
  return out;
}

const KEY = "correct-horse-battery-staple";

void describe("opsAuthGuard", () => {
  void it("is 503 when no key is configured", () => {
    const out = run(undefined, `Bearer ${KEY}`);
    assert.equal(out.status, 503);
    assert.equal(out.next, false);
  });
  void it("rejects a missing, malformed, short, long or wrong key with 401", () => {
    assert.equal(run(KEY, undefined).status, 401);
    assert.equal(run(KEY, "Basic abc").status, 401);
    assert.equal(run(KEY, `Bearer ${KEY.slice(0, -1)}`).status, 401);
    assert.equal(run(KEY, `Bearer ${KEY}x`).status, 401);
    const wrong = run(KEY, "Bearer correct-horse-battery-stapl3");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.rejected, 1);
  });
  void it("passes the exact key through", () => {
    const out = run(KEY, `Bearer ${KEY}`);
    assert.equal(out.next, true);
    assert.equal(out.status, null);
    assert.equal(out.rejected, 0);
  });
});
