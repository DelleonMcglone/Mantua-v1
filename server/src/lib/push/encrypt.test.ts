import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, hkdfSync } from "node:crypto";
import { encryptForPush, MAX_PLAINTEXT_BYTES } from "./encrypt.ts";

/**
 * RFC 8291 Appendix A — the published end-to-end example. The receiver
 * (user agent) keys, the sender's ephemeral key and the salt are fixed, so
 * the output must equal the RFC's byte for byte.
 */
const b64 = (s: string) => Buffer.from(s, "base64url");
const VECTOR = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: b64("BTBZMqHH6r4Tts7J_aSIgg"),
  receiverPrivate: b64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"),
  receiverPublic: b64(
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  ),
  senderPrivate: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
  salt: b64("DGv6ra1nlYgDCS1FRnbzlw"),
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** The browser's half, written here only to prove the round trip. */
function decrypt(body: Buffer, receiverPrivate: Buffer, authSecret: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const senderPublic = body.subarray(21, 86);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(receiverPrivate);
  const receiverPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(senderPublic);
  const label = (s: string, ...p: Buffer[]) => Buffer.concat([Buffer.from(`${s}\0`), ...p]);
  const ikm = Buffer.from(
    hkdfSync(
      "sha256",
      shared,
      authSecret,
      label("WebPush: info", receiverPublic, senderPublic),
      32,
    ),
  );
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, label("Content-Encoding: aes128gcm"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, label("Content-Encoding: nonce"), 12));
  const ct = body.subarray(86, body.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const record = Buffer.concat([decipher.update(ct), decipher.final()]);
  assert.equal(record[record.length - 1], 0x02, "last-record delimiter");
  return record.subarray(0, record.length - 1);
}

void describe("RFC 8291 aes128gcm encryption (MX-004)", () => {
  void it("reproduces the RFC 8291 Appendix A ciphertext exactly", () => {
    const body = encryptForPush(
      {
        plaintext: Buffer.from(VECTOR.plaintext),
        receiverPublicKey: VECTOR.receiverPublic,
        authSecret: VECTOR.authSecret,
      },
      { senderPrivateKey: VECTOR.senderPrivate, salt: VECTOR.salt },
    );
    assert.equal(body.toString("base64url"), VECTOR.body);
  });

  void it("round-trips with fresh random keys and a random salt", () => {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const text = JSON.stringify({ title: "Trade executed", body: "You bought 200 contracts" });
    const body = encryptForPush({
      plaintext: Buffer.from(text),
      receiverPublicKey: receiver.getPublicKey(),
      authSecret: auth,
    });
    assert.equal(body.readUInt32BE(16), 4096, "record size");
    assert.equal(body[20], 65, "key id length");
    assert.equal(decrypt(body, receiver.getPrivateKey(), auth).toString(), text);
    const again = encryptForPush({
      plaintext: Buffer.from(text),
      receiverPublicKey: receiver.getPublicKey(),
      authSecret: auth,
    });
    assert.notEqual(again.toString("hex"), body.toString("hex"), "fresh salt and key per message");
  });

  void it("refuses a payload a push service would reject, and malformed keys", () => {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = Buffer.alloc(16, 1);
    assert.throws(() =>
      encryptForPush({
        plaintext: Buffer.alloc(MAX_PLAINTEXT_BYTES + 1),
        receiverPublicKey: receiver.getPublicKey(),
        authSecret: auth,
      }),
    );
    assert.throws(() =>
      encryptForPush({
        plaintext: Buffer.from("x"),
        receiverPublicKey: receiver.getPublicKey().subarray(1),
        authSecret: auth,
      }),
    );
    assert.throws(() =>
      encryptForPush({
        plaintext: Buffer.from("x"),
        receiverPublicKey: receiver.getPublicKey(),
        authSecret: Buffer.alloc(12),
      }),
    );
  });
});
