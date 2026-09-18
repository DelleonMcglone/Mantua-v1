import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  audioChunkMessage,
  commitMessage,
  readWireMessage,
  SAMPLE_RATE,
  socketUrl,
} from "./voice-wire.ts";

test("the socket URL carries the model, the format and the token — and no key (V-001)", () => {
  const url = new URL(socketUrl({ token: "tok_abc", modelId: "scribe_v2_realtime" }));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "api.elevenlabs.io");
  assert.equal(url.pathname, "/v1/speech-to-text/realtime");
  assert.equal(url.searchParams.get("model_id"), "scribe_v2_realtime");
  assert.equal(url.searchParams.get("audio_format"), "pcm_16000");
  assert.equal(url.searchParams.get("commit_strategy"), "vad");
  assert.equal(url.searchParams.get("token"), "tok_abc");
  assert.equal(url.searchParams.get("xi-api-key"), null, "no key ever reaches the socket");
});

test("audio goes up as a chunk, and release flushes with an empty commit", () => {
  assert.deepEqual(JSON.parse(audioChunkMessage("AAAA")), {
    message_type: "input_audio_chunk",
    audio_base_64: "AAAA",
    commit: false,
    sample_rate: SAMPLE_RATE,
  });
  assert.deepEqual(JSON.parse(commitMessage()), {
    message_type: "input_audio_chunk",
    audio_base_64: "",
    commit: true,
    sample_rate: SAMPLE_RATE,
  });
});

test("transcripts are read by kind; a session start opens the session (V-003)", () => {
  assert.deepEqual(readWireMessage('{"message_type":"session_started","session_id":"s"}'), {
    kind: "open",
  });
  assert.deepEqual(readWireMessage('{"message_type":"partial_transcript","text":"show me the"}'), {
    kind: "partial",
    text: "show me the",
  });
  assert.deepEqual(
    readWireMessage('{"message_type":"committed_transcript","text":"show me the Chiefs"}'),
    { kind: "committed", text: "show me the Chiefs" },
  );
});

test("a commit the server had already handled is not a failure", () => {
  assert.deepEqual(readWireMessage('{"message_type":"commit_throttled","error":"too soon"}'), {
    kind: "ignore",
  });
});

test("each error message maps to the failure the user is told about (V-010)", () => {
  const cases: [string, string][] = [
    ["auth_error", "unavailable"],
    ["quota_exceeded", "quota"],
    ["rate_limited", "rate_limited"],
    ["session_time_limit_exceeded", "dropped"],
    ["transcriber_error", "unavailable"],
    ["error", "unavailable"],
  ];
  for (const [type, failure] of cases) {
    assert.deepEqual(
      readWireMessage(`{"message_type":"${type}","error":"x"}`),
      { kind: "failure", failure },
      type,
    );
  }
});

test("anything unrecognised is ignored rather than guessed at", () => {
  for (const raw of [
    "not json",
    "null",
    "[]",
    '{"no_type":1}',
    '{"message_type":"final_transcript","text":"dup"}',
    '{"message_type":"partial_transcript"}',
    '{"message_type":"something_new"}',
  ]) {
    assert.deepEqual(readWireMessage(raw), { kind: "ignore" }, raw);
  }
});
