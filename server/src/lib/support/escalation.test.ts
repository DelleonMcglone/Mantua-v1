import { describe, it } from "node:test";
import assert from "node:assert/strict";

/** Task 070 / AE-010 — tickets are bounded, the webhook never carries the transcript, and a failed page never throws. */

// The module logs through the shared logger, which boots the env schema.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const {
  buildTicket,
  escalationPayload,
  MAX_SUMMARY_CHARS,
  MAX_TRANSCRIPT_TURNS,
  MAX_TURN_CHARS,
  notifyWebhook,
} = await import("./escalation.ts");

void describe("escalation", () => {
  void it("bounds the summary and keeps only the tail of the transcript, each turn clipped", () => {
    const transcript = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `${String(i)}:${"x".repeat(3000)}`,
    }));
    const row = buildTicket({
      userId: "u1",
      category: "billing",
      summary: `  ${"s".repeat(5000)}  `,
      transcript,
      channel: "web",
    });
    assert.equal(row.summary.length, MAX_SUMMARY_CHARS);
    const kept = row.transcript as { role: string; text: string }[];
    assert.equal(kept.length, MAX_TRANSCRIPT_TURNS);
    assert.ok(kept[0].text.startsWith("8:"));
    assert.equal(kept[0].text.length, MAX_TURN_CHARS);
  });

  void it("pages with the ticket and category but never the transcript or the user id", () => {
    const row = buildTicket({
      userId: "u1",
      category: "trading",
      summary: "stuck trade",
      transcript: [],
      channel: "web",
    });
    const payload = escalationPayload("t1", row, new Date("2026-09-18T15:00:00Z"));
    assert.deepEqual(payload, {
      ticketId: "t1",
      category: "trading",
      summary: "stuck trade",
      channel: "web",
      anonymous: false,
      createdAt: "2026-09-18T15:00:00.000Z",
    });
    assert.ok(!("transcript" in payload) && !("userId" in payload));
  });

  void it("posts JSON to the webhook, and reports false when absent, rejected or failing", async () => {
    const row = buildTicket({
      userId: null,
      category: "other",
      summary: "s",
      transcript: [],
      channel: "api",
    });
    const payload = escalationPayload("t2", row, new Date());
    let seen: { url: string; body: unknown } | null = null;
    const ok = await notifyWebhook("https://hooks.example/x", payload, (url, init) => {
      seen = { url, body: JSON.parse(init.body as string) };
      return Promise.resolve(new Response("", { status: 200 }));
    });
    assert.equal(ok, true);
    assert.deepEqual(seen, { url: "https://hooks.example/x", body: payload });
    assert.equal(
      await notifyWebhook(undefined, payload, () => Promise.reject(new Error("never"))),
      false,
    );
    assert.equal(
      await notifyWebhook("https://hooks.example/x", payload, () =>
        Promise.resolve(new Response("", { status: 500 })),
      ),
      false,
    );
    assert.equal(
      await notifyWebhook("https://hooks.example/x", payload, () =>
        Promise.reject(new Error("down")),
      ),
      false,
    );
  });
});
