import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { confirmationText, sendConfirmation, WAITLIST_FROM } from "./confirmation.ts";

void describe("sendConfirmation", () => {
  void it("is a no-op without a key", async () => {
    const out = await sendConfirmation("fan@example.com", {
      apiKey: undefined,
      fetch: () => Promise.reject(new Error("must not be called")),
    });
    assert.deepEqual(out, { skipped: "no_key" });
  });

  void it("posts one message to Resend from hello@mantua.ai and returns its id", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const out = await sendConfirmation("Fan@example.com", {
      apiKey: "re_test",
      fetch: ((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
      }) as typeof fetch,
    });
    assert.deepEqual(out, { id: "em_1" });
    assert.equal(calls[0]?.url, "https://api.resend.com/emails");
    const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
    assert.equal(body["from"], WAITLIST_FROM);
    assert.deepEqual(body["to"], ["Fan@example.com"]);
    assert.match(String(body["text"]), /What happens next/);
    assert.equal(
      (calls[0]?.init.headers as Record<string, string>)["authorization"],
      "Bearer re_test",
    );
  });

  void it("turns a provider refusal or a network failure into a value, never a throw", async () => {
    const refused = await sendConfirmation("a@b.co", {
      apiKey: "re_test",
      fetch: () => Promise.resolve(new Response("nope", { status: 422 })),
    });
    assert.deepEqual(refused, { error: "resend 422" });
    const down = await sendConfirmation("a@b.co", {
      apiKey: "re_test",
      fetch: () => Promise.reject(new Error("ECONNRESET")),
    });
    assert.deepEqual(down, { error: "ECONNRESET" });
  });

  void it("names the next steps in plain text", () => {
    assert.match(confirmationText(), /email you once when Mantua opens/);
    assert.match(confirmationText(), /Reply to this email/);
  });
});
