/**
 * Task 044 (D-104 / P-010) — the internal resolution ops surface.
 *
 * Style: the real router on an ephemeral express app (market-trade.test
 * convention), auth exercised through the real `requireCronSecret` with a
 * stubbed CRON_SECRET. The store, submitter, and log writer are faked at
 * the seams `createResolutionOpsRouter` exposes for exactly this; audit
 * rows are captured by stubbing the drizzle `db.insert` entry point
 * (agent-chat.test convention). The only untested layer is drizzle SQL,
 * which is exercised against a real Postgres by the migration check.
 */

import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
process.env.CRON_SECRET = "ops-test-secret";

const { createResolutionOpsRouter, summarizeSourcePayload } = await import("./resolution-ops.ts");
const { authorizeManualOverride } = await import("../lib/sports/resolution-criteria.ts");
const { db } = await import("../db/client.ts");

type OpsStore = Parameters<typeof createResolutionOpsRouter>[0] extends
  | { store?: infer S }
  | undefined
  ? NonNullable<S>
  : never;
type Deps = NonNullable<Parameters<typeof createResolutionOpsRouter>[0]>;

const MARKET_ID = `0x${"ab".repeat(32)}` as const;
const NOW = new Date("2026-09-06T18:00:00Z");

// ── audit capture (agent-chat.test convention) ─────────────────────────────
interface AuditRow {
  action: string;
  outcome: string;
  reason: string | null;
  txHash: string | null;
  params: Record<string, unknown>;
}
const audits: AuditRow[] = [];
const realInsert = db.insert.bind(db);
(db as { insert: unknown }).insert = () => ({
  values: (row: AuditRow) => {
    audits.push(row);
    return Promise.resolve();
  },
});

const servers: Server[] = [];
after(() => {
  (db as { insert: unknown }).insert = realInsert;
  for (const s of servers) s.close();
});
beforeEach(() => {
  audits.length = 0;
});

// ── fakes at the router's seams ────────────────────────────────────────────
function fakeStore(overrides: Partial<OpsStore> = {}): OpsStore {
  return {
    reviewFor: () => Promise.resolve(null),
    setHold: () => Promise.resolve("ok" as const),
    clearHold: () => Promise.resolve("ok" as const),
    marketContext: () => Promise.resolve({ state: "FROZEN", providerEventId: "401671789" }),
    markManuallyResolved: () => Promise.resolve(),
    listResolutions: () => Promise.resolve([]),
    listPending: () => Promise.resolve([]),
    ...overrides,
  };
}

function fakeSubmitter(calls: string[]) {
  return {
    signerAddress: () => "0xSIGNER",
    freeze: (id: string) => {
      calls.push(`freeze:${id.slice(0, 6)}`);
      return Promise.resolve(null);
    },
    resolve: (auth: { marketId: string; outcome: number }) => {
      calls.push(`resolve:${String(auth.outcome)}`);
      return Promise.resolve("0xtxmanual");
    },
    void: () => {
      calls.push("void");
      return Promise.resolve("0xtxvoid");
    },
  };
}

function serve(deps: Deps): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(createResolutionOpsRouter(deps));
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

function post(origin: string, path: string, body: unknown, secret = "ops-test-secret") {
  return fetch(`${origin}/api/ops/resolution${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}

void describe("resolution ops — auth posture", () => {
  void it("rejects a wrong or missing cron secret (same gate as the crons)", async () => {
    const origin = await serve({ store: fakeStore() });
    for (const headers of [
      {},
      { authorization: "Bearer wrong" },
    ] as Record<string, string>[]) {
      const res = await fetch(`${origin}/api/ops/resolution`, { headers });
      assert.equal(res.status, 401);
    }
    const res = await post(origin, "/hold", { providerEventId: "x", note: "n" }, "wrong");
    assert.equal(res.status, 401);
  });
});

void describe("POST /api/ops/resolution/hold + /release (D-104 operator hold)", () => {
  void it("refuses a hold without a note (400) — the note is mandatory", async () => {
    const origin = await serve({ store: fakeStore() });
    for (const body of [
      { providerEventId: "401671789" },
      { providerEventId: "401671789", note: "   " },
    ]) {
      const res = await post(origin, "/hold", body);
      assert.equal(res.status, 400);
      const parsed = (await res.json()) as { code?: string };
      assert.equal(parsed.code, "BAD_REQUEST");
    }
    assert.equal(audits.length, 0, "a refused hold writes no audit ink");
  });

  void it("404s when no review row exists for the event", async () => {
    const origin = await serve({
      store: fakeStore({ setHold: () => Promise.resolve("not_found" as const) }),
    });
    const res = await post(origin, "/hold", { providerEventId: "999", note: "why" });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { code?: string }).code, "REVIEW_NOT_FOUND");
  });

  void it("parks a pending outcome with an audit row carrying the note", async () => {
    const held: unknown[] = [];
    const origin = await serve({
      store: fakeStore({
        setHold: (id, chainId, note, at) => {
          held.push([id, chainId, note, at]);
          return Promise.resolve("ok" as const);
        },
      }),
      now: () => NOW,
    });
    const res = await post(origin, "/hold", {
      providerEventId: "401671789",
      note: "scores look wrong on TV",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(held, [["401671789", 8453, "scores look wrong on TV", NOW]]);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "market_resolution");
    assert.equal(audits[0].outcome, "success");
    assert.match(audits[0].reason ?? "", /operator hold set: scores look wrong on TV/);
  });

  void it("release distinguishes no-row (404) from no-hold (409) and audits a real release", async () => {
    const origin404 = await serve({
      store: fakeStore({ clearHold: () => Promise.resolve("not_found" as const) }),
    });
    assert.equal(
      (await post(origin404, "/release", { providerEventId: "x", note: "n" })).status,
      404,
    );

    const origin409 = await serve({
      store: fakeStore({ clearHold: () => Promise.resolve("no_hold" as const) }),
    });
    const res409 = await post(origin409, "/release", { providerEventId: "x", note: "n" });
    assert.equal(res409.status, 409);
    assert.equal(((await res409.json()) as { code?: string }).code, "NO_HOLD");

    audits.length = 0;
    const originOk = await serve({ store: fakeStore() });
    const res = await post(originOk, "/release", {
      providerEventId: "401671789",
      note: "verified against broadcast",
    });
    assert.equal(res.status, 200);
    assert.equal(audits.length, 1);
    assert.match(audits[0].reason ?? "", /operator hold released/);
  });
});

void describe("POST /api/ops/resolution/override (D-104 manual override)", () => {
  void it("503s when no authorised signer is configured (same posture as the cron)", async () => {
    const origin = await serve({ store: fakeStore(), submitterFor: () => null });
    const res = await post(origin, "/override", {
      marketId: MARKET_ID,
      action: "resolve",
      outcome: 0,
      note: "n",
    });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code?: string }).code, "RESOLUTION_DISABLED");
  });

  void it("refuses without a note, without an outcome for resolve, and on a bad marketId", async () => {
    const calls: string[] = [];
    const origin = await serve({ store: fakeStore(), submitterFor: () => fakeSubmitter(calls) });
    for (const body of [
      { marketId: MARKET_ID, action: "resolve", outcome: 0 }, // no note
      { marketId: MARKET_ID, action: "resolve", note: "n" }, // no outcome
      { marketId: "0x123", action: "void", note: "n" }, // malformed id
      { marketId: MARKET_ID, action: "resolve", outcome: 2, note: "n" }, // bad outcome
    ]) {
      const res = await post(origin, "/override", body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(calls.length, 0, "validation failures never touch the chain");
  });

  void it("404s an unknown market and 409s a market not in a resolvable state", async () => {
    const calls: string[] = [];
    const origin404 = await serve({
      store: fakeStore({ marketContext: () => Promise.resolve(null) }),
      submitterFor: () => fakeSubmitter(calls),
    });
    const res404 = await post(origin404, "/override", {
      marketId: MARKET_ID,
      action: "resolve",
      outcome: 0,
      note: "n",
    });
    assert.equal(res404.status, 404);

    for (const state of ["RESOLVED", "SETTLED", "INVALID"]) {
      const origin = await serve({
        store: fakeStore({
          marketContext: () => Promise.resolve({ state, providerEventId: "401671789" }),
        }),
        submitterFor: () => fakeSubmitter(calls),
      });
      const res = await post(origin, "/override", {
        marketId: MARKET_ID,
        action: "resolve",
        outcome: 0,
        note: "n",
      });
      assert.equal(res.status, 409, state);
      assert.equal(((await res.json()) as { code?: string }).code, "MARKET_NOT_RESOLVABLE");
    }
    assert.equal(calls.length, 0, "refusals never touch the chain");
  });

  void it("manual resolve: freeze → resolve via the submitter, method `manual` + note recorded, review settled, audit row with txHash", async () => {
    const calls: string[] = [];
    const records: Record<string, unknown>[] = [];
    const settled: unknown[] = [];
    const origin = await serve({
      store: fakeStore({
        markManuallyResolved: (id, chainId, txHash, note, at) => {
          settled.push([id, chainId, txHash, note, at]);
          return Promise.resolve();
        },
      }),
      submitterFor: () => fakeSubmitter(calls),
      logFor: () => ({
        record: (r) => {
          records.push(r as unknown as Record<string, unknown>);
          return Promise.resolve();
        },
      }),
      now: () => NOW,
    });

    const res = await post(origin, "/override", {
      marketId: MARKET_ID,
      action: "resolve",
      outcome: 1,
      note: "provider outage; verified final on official league site",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { txHash?: string; explorerUrl?: string };
    assert.equal(body.txHash, "0xtxmanual");
    assert.match(body.explorerUrl ?? "", /^https:\/\/basescan\.org\/tx\/0xtxmanual$/);

    // Same submitter path as the sweep: in-line freeze, then resolve.
    assert.deepEqual(calls, [`freeze:${MARKET_ID.slice(0, 6)}`, "resolve:1"]);

    assert.equal(records.length, 1);
    assert.equal(records[0]["method"], "manual");
    assert.equal(records[0]["kind"], "resolve");
    assert.equal(records[0]["outcome"], 1);
    assert.equal(records[0]["source"], "operator");
    assert.equal(records[0]["signer"], "0xSIGNER");
    assert.equal(records[0]["txHash"], "0xtxmanual");
    assert.match(String(records[0]["note"]), /provider outage/);
    const evidence = records[0]["evidence"] as Record<string, unknown>;
    assert.equal(evidence["kind"], "manual-override");
    assert.equal(evidence["providerEventId"], "401671789");

    assert.deepEqual(settled, [
      ["401671789", 8453, "0xtxmanual", "provider outage; verified final on official league site", NOW],
    ]);

    assert.equal(audits.length, 1);
    assert.equal(audits[0].outcome, "success");
    assert.equal(audits[0].txHash, "0xtxmanual");
    assert.match(audits[0].reason ?? "", /manual override \(resolve\)/);
  });

  void it("manual void: submitter.void, null outcome, review left alone (confidence-exempt)", async () => {
    const calls: string[] = [];
    const records: Record<string, unknown>[] = [];
    let reviewTouched = false;
    const origin = await serve({
      store: fakeStore({
        markManuallyResolved: () => {
          reviewTouched = true;
          return Promise.resolve();
        },
      }),
      submitterFor: () => fakeSubmitter(calls),
      logFor: () => ({
        record: (r) => {
          records.push(r as unknown as Record<string, unknown>);
          return Promise.resolve();
        },
      }),
    });
    const res = await post(origin, "/override", {
      marketId: MARKET_ID,
      action: "void",
      note: "game abandoned mid-play",
    });
    assert.equal(res.status, 200);
    assert.ok(calls.includes("void"));
    assert.equal(records[0]["kind"], "void");
    assert.equal(records[0]["method"], "manual");
    assert.equal(records[0]["outcome"], null);
    assert.equal(reviewTouched, false, "voids never advance the confidence review (B4-005)");
  });

  void it("a submitter failure is a 502 with a failure audit row and no record ink", async () => {
    const records: unknown[] = [];
    const origin = await serve({
      store: fakeStore(),
      submitterFor: () => ({
        signerAddress: () => "0xSIGNER",
        freeze: () => Promise.resolve(null),
        resolve: () => Promise.reject(new Error("execution reverted")),
        void: () => Promise.reject(new Error("execution reverted")),
      }),
      logFor: () => ({
        record: (r) => {
          records.push(r);
          return Promise.resolve();
        },
      }),
    });
    const res = await post(origin, "/override", {
      marketId: MARKET_ID,
      action: "resolve",
      outcome: 0,
      note: "n",
    });
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as { code?: string }).code, "SUBMIT_FAILED");
    assert.equal(records.length, 0, "no resolutions row without a landed tx");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].outcome, "failure");
  });
});

void describe("GET /api/ops/resolution (P-010 verifiability surface)", () => {
  void it("lists settlement rows with BaseScan links, window stamps, and payload summaries, plus the pending queue", async () => {
    const opensAt = new Date("2026-09-06T17:00:00Z");
    const closesAt = new Date("2026-09-06T17:15:00Z");
    const origin = await serve({
      store: fakeStore({
        listResolutions: () =>
          Promise.resolve([
            {
              id: "r1",
              marketId: MARKET_ID,
              winningOutcomeIndex: 0,
              method: "auto",
              source: "sportradar",
              sourcePayload: {
                schema: "resolution-evidence@1",
                providerEventId: "401671789",
                policy: "single-source",
                consensus: { kind: "policy-exempt-single-source" },
                criteria: Array.from({ length: 9 }, () => ({ pass: true })),
                decidedAt: "2026-09-06T17:15:05Z",
              },
              signer: "0xSIGNER",
              txHash: "0xdeadbeef",
              note: null,
              confidenceState: "VERIFIED",
              disputeWindowOpensAt: opensAt,
              disputeWindowClosesAt: closesAt,
              createdAt: new Date("2026-09-06T17:15:06Z"),
            } as never,
          ]),
        listPending: () =>
          Promise.resolve([
            {
              id: "p1",
              providerEventId: "401671790",
              chainId: 8453,
              state: "VERIFIED",
              policy: "single-source",
              reason: "policy_exempt_final",
              winningOutcomeIndex: 1,
              firstFinalSeenAt: opensAt,
              disputedAt: null,
              escalatedAt: null,
              resolvedAt: null,
              disputeWindowOpensAt: opensAt,
              disputeWindowClosesAt: closesAt,
              operatorHoldAt: new Date("2026-09-06T17:05:00Z"),
              operatorHoldNote: "checking broadcast",
              history: [],
              createdAt: opensAt,
              updatedAt: closesAt,
            } as never,
          ]),
      }),
    });

    const res = await fetch(`${origin}/api/ops/resolution?limit=10`, {
      headers: { authorization: "Bearer ops-test-secret" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      disputeWindowSeconds: number;
      resolutions: Record<string, unknown>[];
      pending: Record<string, unknown>[];
    };
    assert.equal(typeof body.disputeWindowSeconds, "number");

    const row = body.resolutions[0];
    assert.equal(row["explorerUrl"], "https://basescan.org/tx/0xdeadbeef");
    assert.equal(row["method"], "auto");
    assert.equal(row["signer"], "0xSIGNER");
    assert.equal(row["confidenceState"], "VERIFIED");
    assert.deepEqual(row["disputeWindow"], {
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
    });
    const summary = row["sourcePayloadSummary"] as Record<string, unknown>;
    assert.equal(summary["policy"], "single-source");
    assert.equal(summary["consensus"], "policy-exempt-single-source");
    assert.equal(summary["criteriaPassed"], 9);
    assert.equal(summary["criteriaTotal"], 9);

    const pending = body.pending[0];
    assert.equal(pending["state"], "VERIFIED");
    assert.deepEqual(pending["operatorHold"], {
      at: "2026-09-06T17:05:00.000Z",
      note: "checking broadcast",
    });
    assert.deepEqual(pending["disputeWindow"], {
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
    });
  });
});

void describe("authorizeManualOverride (the D-104 mint)", () => {
  void it("refuses an empty or whitespace note", () => {
    for (const note of ["", "   "]) {
      assert.throws(
        () =>
          authorizeManualOverride({
            marketId: MARKET_ID,
            outcome: 0,
            providerEventId: "401671789",
            note,
          }),
        /non-empty note/,
      );
    }
  });

  void it("mints an authorization whose evidence says plainly it is a manual override", () => {
    const auth = authorizeManualOverride({
      marketId: MARKET_ID,
      outcome: 1,
      providerEventId: "401671789",
      note: "operator call",
      nowSeconds: 1_800_000_000,
    });
    assert.equal(auth.marketId, MARKET_ID);
    assert.equal(auth.outcome, 1);
    assert.equal(auth.criteria.length, 0, "no criteria were checked and none are claimed");
    assert.equal(auth.evidence.kind, "manual-override");
    assert.equal(auth.evidence.note, "operator call");
    assert.equal(auth.evidence.decidedAt, new Date(1_800_000_000 * 1000).toISOString());
  });
});

void describe("summarizeSourcePayload", () => {
  void it("digests non-evidence payloads as a key list and tolerates null", () => {
    assert.equal(summarizeSourcePayload(null), null);
    assert.deepEqual(summarizeSourcePayload({ providerEventId: "x" }), {
      keys: ["providerEventId"],
    });
  });
});
