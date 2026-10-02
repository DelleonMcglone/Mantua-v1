import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GENERIC_TOOL_ERROR, userFacingToolError } from "./tool-error-text.ts";

void describe("userFacingToolError", () => {
  void it("replaces the raw contract-read error the owner saw on screen", () => {
    const raw =
      'The contract function "balanceOf" returned no data ("0x"). This could be due to any of the following: - The contract does not have the function "balanceOf" … Contract Call: address: 0x23037a7d9165e83565d74B543232cE928029717f function: balanceOf(address owner) Docs: https://viem.sh/docs/contract/readContract Version: viem@2.48.4';
    assert.equal(userFacingToolError(raw), GENERIC_TOOL_ERROR);
  });
  void it("replaces network and database failures", () => {
    assert.equal(userFacingToolError("fetch failed"), GENERIC_TOOL_ERROR);
    assert.equal(userFacingToolError('relation "markets" does not exist'), GENERIC_TOOL_ERROR);
    assert.equal(userFacingToolError("execution reverted: NotKeeper()"), GENERIC_TOOL_ERROR);
  });
  void it("keeps a sentence the product wrote for the user", () => {
    const refusal = "That is over your agent's daily limit of $100.";
    assert.equal(userFacingToolError(refusal), refusal);
    assert.equal(
      userFacingToolError("Markets are paused right now."),
      "Markets are paused right now.",
    );
  });
  void it("never returns an empty message", () => {
    assert.equal(userFacingToolError("  "), GENERIC_TOOL_ERROR);
  });
});
