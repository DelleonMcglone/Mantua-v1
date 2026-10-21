import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postAsUser, uploadImage, X_MEDIA_INIT_URL, X_POST_URL } from "./x-user-client.ts";

void describe("x-user-client", () => {
  void it("uploads an image through initialize → append → finalize with the bearer token", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const f = (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = url === X_MEDIA_INIT_URL ? JSON.stringify({ data: { id: "m42" } }) : "{}";
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    const id = await uploadImage("tok", Buffer.from("png"), f);
    assert.equal(id, "m42");
    assert.deepEqual(
      calls.map((c) => c.url),
      [
        X_MEDIA_INIT_URL,
        "https://api.x.com/2/media/upload/m42/append",
        "https://api.x.com/2/media/upload/m42/finalize",
      ],
    );
    assert.equal(
      (calls[0]?.init?.headers as Record<string, string>)["authorization"],
      "Bearer tok",
    );
    assert.ok(calls[1]?.init?.body instanceof FormData);
  });

  void it("posts with the media attached and returns the public URL", async () => {
    let sentBody = "";
    const f = (_url: string, init?: RequestInit) => {
      sentBody = init?.body as string;
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "77" } }), { status: 201 }));
    };
    const out = await postAsUser("tok", "datadealer", "hello", "m42", f);
    assert.deepEqual(out, { ok: true, id: "77", url: "https://x.com/datadealer/status/77" });
    assert.deepEqual(JSON.parse(sentBody), { text: "hello", media: { media_ids: ["m42"] } });
  });

  void it("surfaces X's refusal and a network failure as values", async () => {
    const refused = await postAsUser("tok", "d", "x", null, () =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "duplicate content" }), { status: 403 }),
      ),
    );
    assert.deepEqual(refused, { ok: false, status: 403, error: "duplicate content" });
    const down = await postAsUser("tok", "d", "x", null, () =>
      Promise.reject(new Error("ECONNRESET")),
    );
    assert.deepEqual(down, { ok: false, status: null, error: "ECONNRESET" });
    await assert.rejects(
      uploadImage("tok", Buffer.from("p"), () =>
        Promise.resolve(new Response("{}", { status: 402 })),
      ),
      /media initialize/,
    );
    void X_POST_URL;
  });
});
