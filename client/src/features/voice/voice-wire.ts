/**
 * Task 069 (V-001) — the transcription socket's wire contract, in one
 * place, with no browser API in sight so it can be tested directly.
 *
 * Shapes follow the ElevenLabs realtime speech-to-text protocol: audio
 * goes up as `input_audio_chunk` messages and results come back tagged by
 * `message_type`. Anything we do not recognise is ignored rather than
 * guessed at.
 */
import type { VoiceFailure } from "./voice-types.ts";

export const SOCKET_ORIGIN = "wss://api.elevenlabs.io";
export const SOCKET_PATH = "/v1/speech-to-text/realtime";

/** The AudioContext is created at this rate, so the browser resamples for us. */
export const SAMPLE_RATE = 16_000;
export const AUDIO_FORMAT = "pcm_16000";

/** The worklet, served from our own origin (see client/public/voice). */
export const WORKLET_URL = "/voice/pcm-worklet.js";

/** Builds the socket URL. The token authenticates the session on its own. */
export function socketUrl(input: { token: string; modelId: string }): string {
  const params = new URLSearchParams({
    model_id: input.modelId,
    audio_format: AUDIO_FORMAT,
    // The server commits at natural pauses, so committed text arrives
    // while the user is still speaking rather than only at release.
    commit_strategy: "vad",
    token: input.token,
  });
  return `${SOCKET_ORIGIN}${SOCKET_PATH}?${params.toString()}`;
}

/** One block of microphone audio, base64-encoded. */
export function audioChunkMessage(audioBase64: string): string {
  return JSON.stringify({
    message_type: "input_audio_chunk",
    audio_base_64: audioBase64,
    commit: false,
    sample_rate: SAMPLE_RATE,
  });
}

/** An empty chunk that flushes whatever is buffered into a final segment. */
export function commitMessage(): string {
  return JSON.stringify({
    message_type: "input_audio_chunk",
    audio_base_64: "",
    commit: true,
    sample_rate: SAMPLE_RATE,
  });
}

/** What one inbound frame means to us. */
export type WireEvent =
  | { kind: "open" }
  | { kind: "partial"; text: string }
  | { kind: "committed"; text: string }
  | { kind: "failure"; failure: VoiceFailure }
  | { kind: "ignore" };

/**
 * A commit we asked for that the server had already handled. Benign: the
 * text still arrives through the automatic commit.
 */
const BENIGN = new Set(["commit_throttled", "session_started"]);

const FAILURES: Record<string, VoiceFailure | undefined> = {
  auth_error: "unavailable",
  quota_exceeded: "quota",
  rate_limited: "rate_limited",
  unaccepted_terms: "unavailable",
  invalid_request: "unavailable",
  input_error: "unavailable",
  chunk_size_exceeded: "unavailable",
  queue_overflow: "unavailable",
  resource_exhausted: "unavailable",
  session_time_limit_exceeded: "dropped",
  transcriber_error: "unavailable",
  insufficient_audio_activity: "unavailable",
  error: "unavailable",
};

/**
 * Reads one frame off the socket.
 *
 * @param raw the frame body, which is always JSON text for this protocol
 */
export function readWireMessage(raw: string): WireEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "ignore" };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "ignore" };

  const type = (parsed as { message_type?: unknown }).message_type;
  if (typeof type !== "string") return { kind: "ignore" };
  if (type === "session_started") return { kind: "open" };
  if (BENIGN.has(type)) return { kind: "ignore" };

  const text = (parsed as { text?: unknown }).text;
  if (type === "partial_transcript") {
    return typeof text === "string" ? { kind: "partial", text } : { kind: "ignore" };
  }
  if (type === "committed_transcript") {
    return typeof text === "string" ? { kind: "committed", text } : { kind: "ignore" };
  }

  const failure = FAILURES[type];
  return failure ? { kind: "failure", failure } : { kind: "ignore" };
}
