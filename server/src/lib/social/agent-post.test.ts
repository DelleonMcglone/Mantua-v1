import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postForUser, type AgentPostDeps } from "./agent-post.ts";
import type { Card } from "./card-image.ts";

const card: Card = {
  kind: "basket",
  budgetUsdc: 100,
  placedUsdc: 96.4,
  leftoverUsdc: 3.6,
  legs: [
    {
      label: "Browns YES",
      amountUsdc: 60,
      received: "150.00 YES",
      effectivePriceBps: 4000,
      status: "filled",
    },
    {
      label: "Raiders YES",
      amountUsdc: 36.4,
      received: "90.00 YES",
      effectivePriceBps: 4040,
      status: "filled",
    },
  ],
};

function deps(over: Partial<AgentPostDeps> = {}) {
  const recorded: Parameters<AgentPostDeps["record"]>[0][] = [];
  const d: AgentPostDeps = {
    connection: () => Promise.resolve({ token: "tok", handle: "datadealer" }),
    renderPng: () => Promise.resolve(Buffer.from("png")),
    uploadImage: () => Promise.resolve("m1"),
    post: (_t, handle, _text, mediaId) =>
      Promise.resolve({
        ok: true as const,
        id: "901",
        url: `https://x.com/${handle}/status/901`,
        mediaId,
      } as never),
    record: (row) => {
      recorded.push(row);
      return Promise.resolve();
    },
    ...over,
  };
  return { d, recorded };
}

void describe("postForUser", () => {
  void it("posts the text with the card as an image and records it", async () => {
    const { d, recorded } = deps();
    const out = await postForUser(
      { kind: "basket", text: "Placed a $100 basket. Not betting advice.", card },
      d,
    );
    assert.deepEqual(out, {
      status: "posted",
      id: "901",
      url: "https://x.com/datadealer/status/901",
      withImage: true,
    });
    assert.equal(recorded[0]?.status, "posted");
    assert.equal(recorded[0]?.template, "agent_basket");
    assert.equal(recorded[0]?.externalId, "901");
  });

  void it("refuses text the lint refuses, before touching X", async () => {
    let touched = false;
    const { d, recorded } = deps({
      connection: () => {
        touched = true;
        return Promise.resolve(null);
      },
    });
    const out = await postForUser(
      { kind: "research", text: "This one is a lock, can't lose.", card: null },
      d,
    );
    assert.equal(out.status, "rejected_lint");
    assert.equal(touched, false);
    assert.equal(recorded[0]?.status, "rejected_lint");
  });

  void it("says so when no account is connected, and records nothing", async () => {
    const { d, recorded } = deps({ connection: () => Promise.resolve(null) });
    const out = await postForUser(
      { kind: "research", text: "Hello. Not betting advice.", card: null },
      d,
    );
    assert.deepEqual(out, { status: "not_connected" });
    assert.equal(recorded.length, 0);
  });

  void it("still posts the words when the image upload fails, and records why", async () => {
    const { d, recorded } = deps({
      uploadImage: () => Promise.reject(new Error("media initialize: 402")),
    });
    const out = await postForUser(
      { kind: "basket", text: "Placed a basket. Not betting advice.", card },
      d,
    );
    assert.equal(out.status, "posted");
    assert.equal((out as { withImage: boolean }).withImage, false);
    assert.equal(recorded[0]?.detail["imageError"], "media initialize: 402");
  });

  void it("records a refused post as failed with X's reason", async () => {
    const { d, recorded } = deps({
      post: () => Promise.resolve({ ok: false, status: 403, error: "Forbidden" }),
    });
    const out = await postForUser({ kind: "basket", text: "Placed. Not betting advice.", card }, d);
    assert.deepEqual(out, { status: "failed", error: "Forbidden" });
    assert.equal(recorded[0]?.status, "failed");
  });
});
