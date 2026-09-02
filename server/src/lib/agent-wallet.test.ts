import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveAgentAccountName } from "./agent-wallet-name.ts";

void describe("deriveAgentAccountName", () => {
  void it("namespaces a UUID under the mantua-agent prefix", () => {
    assert.equal(
      deriveAgentAccountName("550e8400-e29b-41d4-a716-446655440000"),
      "mantua-agent-550e8400-e29b-41d4-a716-446655440000",
    );
  });

  void it("is deterministic for the same input", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    assert.equal(deriveAgentAccountName(id), deriveAgentAccountName(id));
  });
});
