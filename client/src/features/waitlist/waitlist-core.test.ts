import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { looksLikeEmail, readWaitlistReply } from "./waitlist-core.ts";

void describe("looksLikeEmail", () => {
  void it("accepts an ordinary address and rejects the obvious misses", () => {
    assert.equal(looksLikeEmail(" fan@example.com "), true);
    for (const bad of ["", "fan", "fan@", "@example.com", "fan@example", "a b@c.io"]) {
      assert.equal(looksLikeEmail(bad), false, bad);
    }
  });
});

void describe("readWaitlistReply", () => {
  void it("maps the server's replies to form states", () => {
    assert.deepEqual(readWaitlistReply(200, { ok: true, already: false }), {
      kind: "done",
      already: false,
    });
    assert.deepEqual(readWaitlistReply(200, { ok: true, already: true }), {
      kind: "done",
      already: true,
    });
    assert.equal(readWaitlistReply(400, { error: "Enter a valid email address." }).kind, "error");
    assert.match((readWaitlistReply(429, null) as { message: string }).message, /give it a minute/);
    assert.match((readWaitlistReply(500, null) as { message: string }).message, /Try again/);
  });
});
