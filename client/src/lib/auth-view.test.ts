import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authView } from "./auth-view.ts";

void describe("authView", () => {
  void it("is logged-out without a session, whatever the wallet says", () => {
    assert.equal(authView({ authenticated: false }), "logged-out");
    assert.equal(authView({ authenticated: false, walletAddress: "0xabc" }), "logged-out");
  });
  void it("is wallet-setup for a session with no wallet — never logged-out", () => {
    assert.equal(authView({ authenticated: true }), "wallet-setup");
    assert.equal(authView({ authenticated: true, walletAddress: null }), "wallet-setup");
    assert.equal(authView({ authenticated: true, walletAddress: "" }), "wallet-setup");
  });
  void it("is signed-in once the session has a wallet", () => {
    assert.equal(authView({ authenticated: true, walletAddress: "0xabc" }), "signed-in");
  });
});
