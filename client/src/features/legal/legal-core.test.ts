import { strict as assert } from "node:assert";
import { test } from "node:test";
import { termsGate } from "./legal-core.ts";

const current = {
  version: "2026-09-13",
  acceptedVersion: "2026-09-13",
  acceptedAt: "x",
  current: true,
};
const stale = { ...current, acceptedVersion: "2026-08-15", current: false };
const never = { ...current, acceptedVersion: null, acceptedAt: null, current: false };

test("the gate never shows to a browser that is only browsing (G-014)", () => {
  assert.equal(termsGate({ authenticated: false, loaded: false, terms: null }), "hidden");
  assert.equal(termsGate({ authenticated: false, loaded: true, terms: never }), "hidden");
});

test("a signed-in user is held while unknown, asked once, then clear", () => {
  assert.equal(termsGate({ authenticated: true, loaded: false, terms: null }), "loading");
  assert.equal(termsGate({ authenticated: true, loaded: true, terms: never }), "required");
  assert.equal(termsGate({ authenticated: true, loaded: true, terms: stale }), "required");
  assert.equal(termsGate({ authenticated: true, loaded: true, terms: current }), "clear");
});

test("a failed read never blocks the ticket — the server refuses stale versions", () => {
  assert.equal(termsGate({ authenticated: true, loaded: true, terms: null }), "clear");
});
