import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import { MAX_PERIOD_DAYS, parsePeriod } from "./institution-period.ts";

/** Task 074 / IC-002 — the statement period is bounded and defaults sensibly. */

function fakeRes() {
  const out: { status: number | null; body: unknown } = { status: null, body: null };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, out };
}

const now = new Date("2026-09-19T12:00:00.000Z");

void describe("parsePeriod", () => {
  void it("defaults to the last 30 days as JSON", () => {
    const { res } = fakeRes();
    const p = parsePeriod({ query: {} }, res, now);
    assert.ok(p);
    assert.equal(p.to.toISOString(), now.toISOString());
    assert.equal(p.from.toISOString(), "2026-08-20T12:00:00.000Z");
    assert.equal(p.format, "json");
  });
  void it("takes explicit bounds and csv", () => {
    const { res } = fakeRes();
    const p = parsePeriod(
      { query: { from: "2026-09-01T00:00:00Z", to: "2026-09-10T00:00:00Z", format: "csv" } },
      res,
      now,
    );
    assert.ok(p);
    assert.equal(p.format, "csv");
    assert.equal(p.from.toISOString(), "2026-09-01T00:00:00.000Z");
  });
  void it("refuses an inverted period, one over a year, and a malformed instant", () => {
    const inverted = fakeRes();
    assert.equal(
      parsePeriod(
        { query: { from: "2026-09-10T00:00:00Z", to: "2026-09-01T00:00:00Z" } },
        inverted.res,
        now,
      ),
      null,
    );
    assert.equal(inverted.out.status, 400);
    assert.equal((inverted.out.body as { code: string }).code, "BAD_PERIOD");
    const long = fakeRes();
    const from = new Date(now.getTime() - (MAX_PERIOD_DAYS + 1) * 86_400_000).toISOString();
    assert.equal(parsePeriod({ query: { from } }, long.res, now), null);
    const bad = fakeRes();
    assert.equal(parsePeriod({ query: { from: "yesterday" } }, bad.res, now), null);
    assert.equal((bad.out.body as { code: string }).code, "BAD_REQUEST");
  });
});
