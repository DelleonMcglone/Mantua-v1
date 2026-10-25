import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashModelVersion } from "./model-version.ts";

const base = {
  model: "claude-opus-4-8",
  prompt: "You are Mantua's agent.",
  tools: [
    { name: "b_tool", description: "second" },
    { name: "a_tool", description: "first" },
  ],
  weights: { edgeThresholdBps: 500, recordPriorGames: 8 },
};

void describe("hashModelVersion", () => {
  void it("is stable for the same inputs whatever the tool order", () => {
    const a = hashModelVersion(base);
    const b = hashModelVersion({ ...base, tools: [...base.tools].reverse() });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{16}$/);
  });

  void it("changes when a weight, the prompt, a tool description or the model changes", () => {
    const v = hashModelVersion(base);
    assert.notEqual(
      hashModelVersion({ ...base, weights: { ...base.weights, edgeThresholdBps: 400 } }),
      v,
    );
    assert.notEqual(hashModelVersion({ ...base, prompt: `${base.prompt} Be bold.` }), v);
    assert.notEqual(
      hashModelVersion({
        ...base,
        tools: [
          { name: "b_tool", description: "second" },
          { name: "a_tool", description: "changed" },
        ],
      }),
      v,
    );
    assert.notEqual(hashModelVersion({ ...base, model: "claude-opus-4-9" }), v);
  });
});
