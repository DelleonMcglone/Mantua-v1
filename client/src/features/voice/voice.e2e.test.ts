import { strict as assert } from "node:assert";
import { test } from "node:test";
import { judgeActivation } from "./activation-core.ts";
import { speechIsAssentOnly } from "./confirm-guard.ts";
import { applyCorrections } from "./correction-core.ts";
import { readAgentInput, sourceOf } from "./spoken-command.ts";
import { applyCommitted, applyPartial, EMPTY_TRANSCRIPT, finalText } from "./transcript-core.ts";
import { readWireMessage } from "./voice-wire.ts";
import type { Transcript } from "./voice-types.ts";

/**
 * Task 069 (V-011, composed) — one press, end to end over the real wire
 * shapes. The browser spec proves the journey on screen; this proves the
 * pieces compose the way the journey assumes, without a browser.
 */

/** Replays socket frames through the transcript, as the transport does. */
function replay(frames: string[]): Transcript {
  let transcript = EMPTY_TRANSCRIPT;
  for (const frame of frames) {
    const wire = readWireMessage(frame);
    if (wire.kind === "partial") transcript = applyPartial(transcript, wire.text);
    else if (wire.kind === "committed") transcript = applyCommitted(transcript, wire.text);
  }
  return transcript;
}

const frame = (type: string, text: string) => JSON.stringify({ message_type: type, text });

test("a spoken research question becomes the text a typed one would have been", () => {
  const transcript = replay([
    '{"message_type":"session_started","session_id":"s"}',
    frame("partial_transcript", "should I"),
    frame("partial_transcript", "should I buy the"),
    frame("committed_transcript", "Should I buy the Falcons"),
    frame("partial_transcript", "YES con"),
    frame("committed_transcript", "YES contract?"),
  ]);

  assert.equal(finalText(transcript), "Should I buy the Falcons YES contract?");

  const verdict = judgeActivation({ pressMs: 2_400, text: finalText(transcript) });
  assert.deepEqual(verdict, { kind: "submit", text: "Should I buy the Falcons YES contract?" });
  assert.equal(
    applyCorrections(verdict.text),
    "Should I buy the Falcons YES contract?",
    "nothing to correct, nothing changed",
  );
  assert.ok(!speechIsAssentOnly(verdict.text), "a question is not consent");
});

test("a spoken trade with a correction submits the figure the speaker landed on", () => {
  const transcript = replay([
    frame("committed_transcript", "Buy fifty of the Chiefs,"),
    frame("committed_transcript", "no make that twenty"),
  ]);

  const verdict = judgeActivation({ pressMs: 3_000, text: finalText(transcript) });
  assert.ok(verdict.kind === "submit");
  assert.equal(applyCorrections(verdict.text), "Buy twenty of the Chiefs");
});

test("a spoken assent is caught before it is ever sent, and marked voice if it were", () => {
  const transcript = replay([frame("committed_transcript", "confirm")]);
  const verdict = judgeActivation({ pressMs: 900, text: finalText(transcript) });
  assert.deepEqual(verdict, { kind: "submit", text: "confirm" });
  assert.ok(speechIsAssentOnly(verdict.text), "the client stops it here (V-009)");
  assert.equal(sourceOf(true), "voice", "and the server would refuse it anyway");
});

test("a dropped socket keeps what settled and loses only the guess in flight", () => {
  const transcript = replay([
    frame("committed_transcript", "Show me the best NFL markets"),
    frame("partial_transcript", "toni"),
    '{"message_type":"session_time_limit_exceeded","error":"too long"}',
  ]);
  assert.equal(finalText(transcript), "Show me the best NFL markets");
  assert.deepEqual(readWireMessage('{"message_type":"session_time_limit_exceeded","error":"x"}'), {
    kind: "failure",
    failure: "dropped",
  });
});

test("a silent press yields the retry rather than an empty command", () => {
  const transcript = replay([frame("partial_transcript", "uh"), frame("committed_transcript", "")]);
  assert.deepEqual(judgeActivation({ pressMs: 1_800, text: finalText(transcript) }), {
    kind: "retry",
  });
});

test("provenance survives the hop to the agent panel, and an old payload still reads", () => {
  assert.deepEqual(readAgentInput({ text: "buy the Chiefs", spoken: true }), {
    text: "buy the Chiefs",
    spoken: true,
  });
  assert.deepEqual(readAgentInput("typed the old way"), {
    text: "typed the old way",
    spoken: false,
  });
  assert.deepEqual(readAgentInput(undefined), { text: "", spoken: false });
  assert.equal(sourceOf(false), "text");
});
