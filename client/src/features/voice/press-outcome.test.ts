import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MIN_PRESS_MS } from "./activation-core.ts";
import { resolvePress, settleImmediately } from "./press-outcome.ts";
import { NO_SPEECH_NOTICE, SPOKEN_CONFIRM_NOTICE } from "./voice-status-core.ts";

test("a held press with words becomes the command, corrections applied (V-006)", () => {
  assert.deepEqual(resolvePress({ pressMs: 2_000, text: "Show me the best NFL markets tonight" }), {
    kind: "submit",
    text: "Show me the best NFL markets tonight",
  });
  assert.deepEqual(resolvePress({ pressMs: 2_000, text: "buy fifty Chiefs, no make that ten" }), {
    kind: "submit",
    text: "buy ten Chiefs",
  });
});

test("a mis-press is silent and a silent press is not (V-007/V-010)", () => {
  assert.deepEqual(resolvePress({ pressMs: 100, text: "" }), { kind: "quiet" });
  assert.deepEqual(resolvePress({ pressMs: 2_000, text: "" }), {
    kind: "notice",
    notice: NO_SPEECH_NOTICE,
  });
  assert.deepEqual(resolvePress({ pressMs: 2_000, text: "[BLANK_AUDIO]" }), {
    kind: "notice",
    notice: NO_SPEECH_NOTICE,
  });
});

test("a bare assent is stopped here rather than sent (V-009)", () => {
  for (const said of ["confirm", "Yes.", "go ahead", "do it"]) {
    assert.deepEqual(
      resolvePress({ pressMs: 900, text: said }),
      { kind: "notice", notice: SPOKEN_CONFIRM_NOTICE },
      said,
    );
  }
  // A command that merely opens with assent is still a command.
  assert.deepEqual(resolvePress({ pressMs: 900, text: "yes, show me the Chiefs" }), {
    kind: "submit",
    text: "yes, show me the Chiefs",
  });
});

test("a correction that empties the utterance submits nothing at all", () => {
  assert.deepEqual(resolvePress({ pressMs: 1_500, text: "scratch that" }), { kind: "quiet" });
});

test("release waits only when words are still in flight", () => {
  const settled = { committed: "show me the Chiefs", partial: "" };
  const inFlight = { committed: "show me the", partial: "Chief" };
  const nothing = { committed: "", partial: "" };

  assert.equal(settleImmediately({ pressMs: 2_000, transcript: settled }), true);
  assert.equal(settleImmediately({ pressMs: 2_000, transcript: inFlight }), false);
  assert.equal(
    settleImmediately({ pressMs: 2_000, transcript: nothing }),
    false,
    "a held press with nothing yet waits for the tail before giving up",
  );

  // A mis-press never waits: the button must be usable again at once.
  assert.equal(settleImmediately({ pressMs: MIN_PRESS_MS - 1, transcript: nothing }), true);
  assert.equal(settleImmediately({ pressMs: MIN_PRESS_MS - 1, transcript: inFlight }), true);
});
