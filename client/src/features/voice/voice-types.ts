/**
 * Task 069 (Phase 12) — the shapes the voice layer speaks in.
 *
 * Deliberately small: voice produces text and nothing else. There is no
 * intent type here, no command type, and no execution type, because a
 * spoken command is a typed command that arrived by microphone.
 */

/**
 * One session's text, split by how settled it is. `committed` will not
 * change; `partial` is the model's current guess at the words still being
 * spoken and is replaced as it revises (V-003, V-006).
 */
export interface Transcript {
  committed: string;
  partial: string;
}

/** Everything that can stop a session, each with its own sentence (V-010). */
export type VoiceFailure =
  | "permission_denied"
  | "no_device"
  | "not_configured"
  | "quota"
  | "rate_limited"
  | "unavailable"
  | "dropped";

/**
 * `unavailable` is terminal for the page: the button stops being offered.
 * Everything else leaves the button usable for another try.
 */
export type VoicePhase = "idle" | "starting" | "listening" | "settling" | "unavailable";

/** Callbacks the transport drives; each one is a plain fact, never a decision. */
export interface VoiceTransportEvents {
  onOpen: () => void;
  onPartial: (text: string) => void;
  onCommitted: (text: string) => void;
  onFailure: (failure: VoiceFailure) => void;
}

/** A live session. `stop` ends it cleanly; `cancel` throws the audio away. */
export interface VoiceSessionHandle {
  stop: () => void;
  cancel: () => void;
}

/** What `useVoiceInput` hands the command bar. */
export interface VoiceInput {
  supported: boolean;
  phase: VoicePhase;
  transcript: Transcript;
  notice: string | null;
  press: () => void;
  release: () => void;
}

/**
 * The seam between the cores and the microphone. The real implementation
 * captures audio and opens the transcription socket; the browser suite
 * swaps in one that replays a script (see client/e2e/voice-transport-shim.ts).
 */
export interface VoiceTransport {
  /** False when this browser cannot capture audio at all. */
  supported: () => boolean;
  start: (events: VoiceTransportEvents) => Promise<VoiceSessionHandle>;
}
