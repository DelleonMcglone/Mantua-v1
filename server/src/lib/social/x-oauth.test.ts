import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeUrl,
  exchangeCode,
  openHandoff,
  openToken,
  pkcePair,
  refreshTokens,
  revokeToken,
  sealHandoff,
  sealToken,
  whoAmI,
  X_TOKEN_URL,
} from "./x-oauth.ts";

const app = {
  clientId: "cid",
  clientSecret: "shh",
  redirectUri: "https://www.mantua.ai/api/social/x/callback",
};

void describe("x-oauth", () => {
  void it("builds a PKCE consent URL with the scopes the agent needs", () => {
    const { verifier, challenge } = pkcePair();
    assert.ok(verifier.length >= 43 && challenge.length === 43);
    const u = new URL(authorizeUrl(app, "st8", challenge));
    assert.equal(u.origin + u.pathname, "https://x.com/i/oauth2/authorize");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(u.searchParams.get("state"), "st8");
    assert.match(u.searchParams.get("scope") ?? "", /tweet\.write/);
    assert.match(u.searchParams.get("scope") ?? "", /media\.write/);
    assert.match(u.searchParams.get("scope") ?? "", /offline\.access/);
  });

  void it("seals and opens the handoff; rejects tampering and expiry", () => {
    const h = { userId: "u1", state: "s", verifier: "v", expiresAt: 1000 };
    const sealed = sealHandoff("k", h);
    assert.deepEqual(openHandoff("k", sealed, 999), h);
    assert.equal(openHandoff("k", sealed, 1000), null);
    assert.equal(openHandoff("other", sealed, 999), null);
    assert.equal(openHandoff("k", `${sealed}x`, 999), null);
    assert.equal(openHandoff("k", "garbage", 999), null);
  });

  void it("seals tokens so only the same secret opens them", () => {
    const sealed = sealToken("shh", "access-123");
    assert.notEqual(sealed, "access-123");
    assert.equal(openToken("shh", sealed), "access-123");
    assert.throws(() => openToken("nope", sealed));
    assert.notEqual(sealToken("shh", "a"), sealToken("shh", "a"), "fresh iv every time");
  });

  void it("exchanges the code with Basic auth and the verifier, and refreshes", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 7200,
            scope: "tweet.write",
          }),
        ),
      );
    }) as typeof fetch;
    const t = await exchangeCode(app, "code1", "ver1", f, 100);
    assert.deepEqual(t, {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: 7300,
      scope: "tweet.write",
    });
    assert.equal(calls[0]?.url, X_TOKEN_URL);
    const form = new URLSearchParams(calls[0]?.init.body as string);
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code_verifier"), "ver1");
    assert.equal(
      (calls[0]?.init.headers as Record<string, string>)["authorization"],
      `Basic ${Buffer.from("cid:shh").toString("base64")}`,
    );
    await refreshTokens(app, "rt", f, 100);
    assert.equal(
      new URLSearchParams(calls[1]?.init.body as string).get("grant_type"),
      "refresh_token",
    );
  });

  void it("reads the account from users/me and treats a failed revoke as false", async () => {
    const me = await whoAmI("at", () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { id: "9", username: "datadealer", name: "D" } })),
      ),
    );
    assert.deepEqual(me, { id: "9", handle: "datadealer", name: "D" });
    assert.equal(await revokeToken(app, "at", () => Promise.reject(new Error("down"))), false);
    assert.equal(
      await revokeToken(app, "at", () => Promise.resolve(new Response("", { status: 200 }))),
      true,
    );
  });
});
