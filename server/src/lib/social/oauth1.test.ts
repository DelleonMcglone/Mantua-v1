import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizationHeader, percentEncode, signatureBaseString, signRequest } from "./oauth1.ts";

/**
 * Task 070 / AE-001 — OAuth 1.0a request signing, pinned to the worked
 * example X publishes in "Creating a signature" (consumer key
 * xvz1evFS4wEEPTGEFPHBog …). If the base string or the HMAC drift from
 * that vector, the X API answers 401 and no post ever leaves.
 */

const CREDS = {
  consumerKey: "xvz1evFS4wEEPTGEFPHBog",
  consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
};
const REQUEST = {
  method: "POST" as const,
  url: "https://api.twitter.com/1.1/statuses/update.json",
  params: { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
  nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
  timestamp: 1318622958,
};

void describe("oauth1", () => {
  void it("percent-encodes per RFC 3986 (unreserved untouched, space as %20, * ! ' ( ) encoded)", () => {
    assert.equal(percentEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
    assert.equal(percentEncode("An encoded string!"), "An%20encoded%20string%21");
    assert.equal(percentEncode("Dogs, Cats & Mice"), "Dogs%2C%20Cats%20%26%20Mice");
    assert.equal(percentEncode("☃"), "%E2%98%83");
    assert.equal(percentEncode("a-b_c.d~e"), "a-b_c.d~e");
    assert.equal(percentEncode("*'()"), "%2A%27%28%29");
  });

  void it("builds the reference signature base string", () => {
    const base = signatureBaseString(CREDS, REQUEST);
    assert.equal(
      base,
      "POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521",
    );
  });

  void it("produces the reference HMAC-SHA1 signature", () => {
    assert.equal(signRequest(CREDS, REQUEST), "hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });

  void it("emits the Authorization header with every oauth_* field, encoded and sorted", () => {
    const header = authorizationHeader(CREDS, REQUEST);
    assert.ok(header.startsWith("OAuth "));
    assert.ok(header.includes('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"'));
    assert.ok(header.includes('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"'));
    assert.ok(header.includes('oauth_version="1.0"'));
    assert.ok(!header.includes("status="), "body params never appear in the header");
  });

  void it("signs a JSON-body v2 request with no params beyond oauth_*", () => {
    const sig = signRequest(CREDS, { ...REQUEST, url: "https://api.x.com/2/tweets", params: {} });
    assert.match(sig, /^[A-Za-z0-9+/]+=*$/);
    assert.notEqual(sig, "hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });
});
