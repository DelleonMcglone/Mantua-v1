import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { verifySignatureWithKey } from "./webhook-verify.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

function signBody(body: Buffer): string {
  const signer = createSign("SHA256");
  signer.update(body);
  return signer.sign(privateKey).toString("base64");
}

describe("verifySignatureWithKey", () => {
  const body = Buffer.from(
    JSON.stringify({ notificationId: "n1", notification: { state: "CONFIRMED" } }),
  );
  const signature = signBody(body);

  it("accepts a valid ECDSA-SHA256 signature over the raw body", () => {
    assert.equal(verifySignatureWithKey(body, signature, publicKey), true);
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(body.toString("utf8").replace("CONFIRMED", "SENT"));
    assert.equal(verifySignatureWithKey(tampered, signature, publicKey), false);
  });

  it("rejects a garbage signature", () => {
    assert.equal(verifySignatureWithKey(body, "not-a-real-signature", publicKey), false);
  });
});
