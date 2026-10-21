import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLoginPath, waitlistGate } from "./waitlist-core.ts";

void describe("waitlistGate", () => {
  void it("sends logged-out visitors to the waitlist only while the flag is on", () => {
    const base = { frontDoor: true, authenticated: false, loginRequested: false };
    assert.equal(waitlistGate({ ...base, routeKind: "home" }), true);
    assert.equal(waitlistGate({ ...base, routeKind: "market" }), true);
    assert.equal(waitlistGate({ ...base, routeKind: "agent" }), true);
    for (const k of ["waitlist", "legal", "docs", "agent-public"]) {
      assert.equal(waitlistGate({ ...base, routeKind: k }), false, k);
    }
    assert.equal(waitlistGate({ ...base, routeKind: "home", authenticated: true }), false);
    assert.equal(waitlistGate({ ...base, routeKind: "home", loginRequested: true }), false);
    assert.equal(waitlistGate({ ...base, routeKind: "home", frontDoor: false }), false);
  });
  void it("recognises /login with or without a trailing slash", () => {
    assert.equal(isLoginPath("/login"), true);
    assert.equal(isLoginPath("/login/"), true);
    assert.equal(isLoginPath("/"), false);
  });
});
