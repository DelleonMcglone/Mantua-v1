import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { createActivityRouter, toActivityDto } = await import("./activity.ts");
type ActivityRouteDeps = import("./activity.ts").ActivityRouteDeps;
type Activity = import("../db/schema/activity.ts").Activity;

/**
 * Phase 9 / PF-019 — GET /api/activity through the real router with the
 * list seam faked: the feed spans the user's id, their wallet and their
 * agent wallet; filters and the cursor pass through; unknown kinds are
 * refused; rows arrive as DTOs with a category and a numeric value.
 */

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

const USER_WALLET = "0x00000000000000000000000000000000000000aa";
const AGENT_WALLET = "0x00000000000000000000000000000000000000bb";

function row(over: Partial<Activity>): Activity {
  return {
    id: "act_1",
    userId: "usr_1",
    walletAddress: USER_WALLET,
    kind: "market_buy",
    status: "completed",
    actor: "user",
    chainId: 8453,
    marketId: null,
    poolId: null,
    positionRef: null,
    asset: "YES",
    amountRaw: "16000000",
    valueUsd: "10.00",
    summary: "bought 16.00 YES for $10.00",
    refId: null,
    txHash: `0x${"a".repeat(64)}`,
    data: {},
    createdAt: new Date("2026-09-12T20:00:00Z"),
    updatedAt: new Date("2026-09-12T20:00:00Z"),
    ...over,
  };
}

function serve(list: ActivityRouteDeps["list"]): Promise<string> {
  const app = express();
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    req.walletAddress = USER_WALLET;
    next();
  });
  app.use(
    createActivityRouter({
      list,
      resolveUser: () => Promise.resolve("usr_1"),
      agentWalletAddress: () => Promise.resolve(AGENT_WALLET),
    }),
  );
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

void describe("GET /api/activity", () => {
  void it("queries by user id, user wallet and agent wallet, passes filters and the cursor, returns DTOs", async () => {
    const seen: unknown[] = [];
    const origin = await serve((_db, q) => {
      seen.push(q);
      return Promise.resolve([
        row({}),
        row({ id: "act_2", actor: "agent", walletAddress: AGENT_WALLET, kind: "hedge" }),
      ]);
    });
    const res = await fetch(
      `${origin}/api/activity?limit=2&kind=market_buy,hedge&actor=agent&before=2026-09-12T21:00:00.000Z`,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      items: { id: string; category: string; valueUsd: number }[];
      nextBefore: string | null;
    };
    assert.equal(body.items.length, 2);
    assert.equal(body.items[0]?.category, "trade");
    assert.equal(body.items[0]?.valueUsd, 10);
    assert.equal(body.nextBefore, "2026-09-12T20:00:00.000Z", "a full page hands back a cursor");
    const q = seen[0] as {
      userId: string;
      walletAddresses: string[];
      kinds: string[];
      actor: string;
      before: string;
      limit: number;
    };
    assert.equal(q.userId, "usr_1");
    assert.deepEqual(q.walletAddresses, [USER_WALLET, AGENT_WALLET]);
    assert.deepEqual(q.kinds, ["market_buy", "hedge"]);
    assert.equal(q.actor, "agent");
    assert.equal(q.limit, 2);
  });

  void it("refuses an unknown kind and reports a short page without a cursor", async () => {
    const origin = await serve(() => Promise.resolve([row({})]));
    const bad = await fetch(`${origin}/api/activity?kind=teleport`);
    assert.equal(bad.status, 400);
    const ok = await fetch(`${origin}/api/activity`);
    const body = (await ok.json()) as { items: unknown[]; nextBefore: string | null };
    assert.equal(body.items.length, 1);
    assert.equal(body.nextBefore, null);
  });

  void it("toActivityDto exposes the timeline fields with a category", () => {
    const dto = toActivityDto(
      row({ kind: "agent_research", actor: "agent", valueUsd: null, txHash: null }),
    );
    assert.equal(dto.category, "agent");
    assert.equal(dto.valueUsd, null);
    assert.equal(dto.txHash, null);
    assert.equal(dto.createdAt, "2026-09-12T20:00:00.000Z");
  });
});
