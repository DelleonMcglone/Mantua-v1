import { strict as assert } from "node:assert";
import { test } from "node:test";
import { judgeActivation, meaningfulText, MIN_PRESS_MS } from "./activation-core.ts";

test("a press too brief to hold a word passes in silence (V-007)", () => {
  assert.deepEqual(judgeActivation({ pressMs: 80, text: "" }), { kind: "discard" });
  assert.deepEqual(
    judgeActivation({ pressMs: MIN_PRESS_MS - 1, text: "buy the Chiefs" }),
    { kind: "discard" },
    "a bump is a bump even if the model heard the room",
  );
});

test("a real press that heard nothing earns the retry, not silence (V-007/V-010)", () => {
  assert.deepEqual(judgeActivation({ pressMs: 2_000, text: "" }), { kind: "retry" });
  assert.deepEqual(judgeActivation({ pressMs: 2_000, text: "   " }), { kind: "retry" });
});

test("model artefacts count as silence, not as a command", () => {
  for (const artefact of ["[BLANK_AUDIO]", "(silence)", "uh", "Um", "Thank you.", "."]) {
    assert.equal(meaningfulText(artefact), "", artefact);
    assert.deepEqual(
      judgeActivation({ pressMs: 1_500, text: artefact }),
      { kind: "retry" },
      artefact,
    );
  }
});

test("a held press with words in it is the user's command", () => {
  assert.deepEqual(
    judgeActivation({ pressMs: 1_800, text: "  Show me the best NFL markets tonight  " }),
    {
      kind: "submit",
      text: "Show me the best NFL markets tonight",
    },
  );
});

test("a short but real word survives", () => {
  assert.deepEqual(judgeActivation({ pressMs: 600, text: "go" }), { kind: "submit", text: "go" });
});
