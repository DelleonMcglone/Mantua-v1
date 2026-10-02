import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env["NODE_ENV"] ??= "test";
process.env["DATABASE_URL"] ??= "postgres://localhost:5432/mantua";
process.env["PRIVY_APP_ID"] ??= "test";
process.env["PRIVY_APP_SECRET"] ??= "test";

const { describeWalletProvisionError } = await import("./agent-wallet-error.ts");
const { UserNotFoundError } = await import("./agent-wallet.ts");
const { CircleUnavailableError } = await import("./circle/client.ts");

void describe("describeWalletProvisionError", () => {
  void it("tells a brand-new account to wait, not that something broke", () => {
    const r = describeWalletProvisionError(new UserNotFoundError("did:privy:x"));
    assert.equal(r.reason, "user_not_found");
    assert.match(r.message, /being set up/);
  });
  void it("names an outage as an outage", () => {
    const r = describeWalletProvisionError(new CircleUnavailableError());
    assert.equal(r.reason, "circle_unavailable");
    assert.match(r.message, /temporarily unavailable/);
  });
  void it("keeps the real cause for the log and gives the user a retryable sentence", () => {
    const r = describeWalletProvisionError(new Error("Circle 400: sca core not supported"));
    assert.equal(r.reason, "Circle 400: sca core not supported");
    assert.doesNotMatch(r.message, /Circle|sca|400/i);
    assert.match(r.message, /try again/);
  });
  void it("handles a thrown non-Error", () => {
    assert.equal(describeWalletProvisionError("boom").reason, "unknown");
  });
});
