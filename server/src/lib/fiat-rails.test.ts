import assert from "node:assert/strict";
import test from "node:test";
import { createSandboxTransfer, getFiatRailState, linkSandboxBank } from "./fiat-rails.ts";

// Runs only when FIAT_RAILS_MODE=sandbox. Production remains fail-closed.
test(
  "sandbox bank link is required before a transfer",
  { skip: process.env.FIAT_RAILS_MODE !== "sandbox" },
  () => {
    const id = "fiat-rail-test";
    assert.equal(getFiatRailState(id).bankLinked, false);
    linkSandboxBank(id);
    const transfer = createSandboxTransfer(id, "deposit", "25.00");
    assert.equal(transfer.status, "pending");
    assert.equal(getFiatRailState(id).transfers[0]?.id, transfer.id);
  },
);
