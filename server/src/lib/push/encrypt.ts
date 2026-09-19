/**
 * Task 071 (MX-004) — RFC 8291 message encryption for Web Push, the
 * `aes128gcm` content coding of RFC 8188, on node:crypto alone.
 *
 * The browser hands us its subscription's P-256 public key and a 16-byte
 * auth secret. For every message the server picks a fresh key pair and
 * salt, agrees a shared secret over ECDH, derives the content key and
 * nonce through HKDF exactly as RFC 8291 §3 lays out, and ships one
 * record: the payload, a 0x02 delimiter, and the GCM tag, behind the
 * RFC 8188 header (salt, record size, the sender's public key). The push
 * service sees ciphertext only; the browser's service worker decrypts.
 *
 * Verified against the RFC 8291 Appendix A vector in encrypt.test.ts.
 */
import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

export const RECORD_SIZE = 4096;
const HEADER_BYTES = 16 + 4 + 1 + 65;
const TAG_BYTES = 16;
const DELIMITER_BYTES = 1;
/** The largest plaintext one record carries — push services cap at 4 kB. */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - HEADER_BYTES - TAG_BYTES - DELIMITER_BYTES;

export interface EncryptInput {
  plaintext: Uint8Array;
  /** The subscription's `p256dh` key, raw uncompressed (65 bytes). */
  receiverPublicKey: Uint8Array;
  /** The subscription's `auth` secret (16 bytes). */
  authSecret: Uint8Array;
}

/** Seams for the RFC vector; production draws both at random. */
export interface EncryptSeams {
  senderPrivateKey?: Uint8Array;
  salt?: Uint8Array;
}

const info = (label: string, ...parts: Uint8Array[]): Buffer =>
  Buffer.concat([Buffer.from(`${label}\0`, "ascii"), ...parts]);

export function encryptForPush(input: EncryptInput, seams: EncryptSeams = {}): Buffer {
  if (input.plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error(`push payload too large: ${String(input.plaintext.length)} bytes`);
  }
  if (input.receiverPublicKey.length !== 65 || input.receiverPublicKey[0] !== 0x04) {
    throw new Error("receiver key must be an uncompressed P-256 point");
  }
  if (input.authSecret.length !== 16) throw new Error("auth secret must be 16 bytes");

  const ecdh = createECDH("prime256v1");
  if (seams.senderPrivateKey) ecdh.setPrivateKey(seams.senderPrivateKey);
  else ecdh.generateKeys();
  const senderPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(input.receiverPublicKey);
  const salt = Buffer.from(seams.salt ?? randomBytes(16));

  // RFC 8291 §3.3–3.4: IKM from the ECDH secret and the auth secret, then
  // the content key and nonce from IKM and the salt.
  const ikm = Buffer.from(
    hkdfSync(
      "sha256",
      sharedSecret,
      input.authSecret,
      info("WebPush: info", input.receiverPublicKey, senderPublicKey),
      32,
    ),
  );
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, info("Content-Encoding: aes128gcm"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, info("Content-Encoding: nonce"), 12));

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // One record: payload, the last-record delimiter, then the tag.
  const record = Buffer.concat([input.plaintext, Buffer.from([0x02])]);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(HEADER_BYTES);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(65, 20);
  Buffer.from(senderPublicKey).copy(header, 21);
  return Buffer.concat([header, ciphertext]);
}
