/**
 * 031 — agent swap slippage threading.
 *
 * The route validated `slippageTolerance` (fractional percent, max 5)
 * and then silently dropped it — `AgentSwapArgs` had no such field, so
 * agent swaps executed with no min-out at all. `agentSlippageBps` is the
 * lib-side conversion + re-assertion of the hard cap; these tests pin
 * the default, the conversion, and the cap for callers that bypass the
 * route's zod schema (chat tool, intents, rebalance).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";

const { agentSlippageBps } = await import("./agent-swap.ts");
const { DEFAULT_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS } = await import("./constants.ts");
const { SafetyError } = await import("./errors.ts");

void describe("agentSlippageBps", () => {
  void it("defaults to DEFAULT_SLIPPAGE_BPS when the caller passes nothing", () => {
    assert.equal(agentSlippageBps(undefined), DEFAULT_SLIPPAGE_BPS);
    assert.equal(agentSlippageBps(), DEFAULT_SLIPPAGE_BPS);
  });

  void it("converts fractional percent to bps", () => {
    assert.equal(agentSlippageBps(0.5), 50);
    assert.equal(agentSlippageBps(1), 100);
    assert.equal(agentSlippageBps(5), MAX_SLIPPAGE_BPS);
  });

  void it("throws SafetyError above the MAX_SLIPPAGE_BPS hard cap", () => {
    assert.throws(() => agentSlippageBps(5.01), SafetyError);
    assert.throws(() => agentSlippageBps(100), SafetyError);
  });

  void it("throws SafetyError on negative / non-finite input", () => {
    assert.throws(() => agentSlippageBps(-0.5), SafetyError);
    assert.throws(() => agentSlippageBps(Number.NaN), SafetyError);
  });
});
