/**
 * Task 069 (V-011) — the browser suite's stand-in for the microphone.
 *
 * Playwright has no voice, and a test that needed one would be testing
 * ElevenLabs rather than Mantua. Under `VITE_E2E_AUTH=shim` this module
 * replaces `features/voice/voice-transport.ts` through a Vite alias, the
 * same mechanism the suite already uses for the authentication SDK, so a
 * production build never contains it.
 *
 * Everything the transport would decide is decided elsewhere, in the tested
 * pure modules, so replacing it swaps only the audio and the socket. A spec
 * drives a session through `window.__mantuaVoice`.
 */
import type {
  VoiceFailure,
  VoiceSessionHandle,
  VoiceTransport,
  VoiceTransportEvents,
} from "@/features/voice/voice-types.ts";

interface VoiceHarness {
  /** True while a push-to-talk session is open. */
  live: () => boolean;
  /** The model's provisional guess at the words being spoken. */
  partial: (text: string) => void;
  /** A settled segment. */
  commit: (text: string) => void;
  /** Ends the session the way a real failure would. */
  fail: (failure: VoiceFailure) => void;
}

declare global {
  interface Window {
    __mantuaVoice?: VoiceHarness;
  }
}

let open: VoiceTransportEvents | null = null;

const harness: VoiceHarness = {
  live: () => open !== null,
  partial: (text) => open?.onPartial(text),
  commit: (text) => open?.onCommitted(text),
  fail: (failure) => {
    const events = open;
    open = null;
    events?.onFailure(failure);
  },
};

if (typeof window !== "undefined") window.__mantuaVoice = harness;

export const voiceTransport: VoiceTransport = {
  supported: () => true,

  start(events: VoiceTransportEvents): Promise<VoiceSessionHandle> {
    open = events;
    // The socket's session_started arrives a tick after connecting.
    queueMicrotask(() => {
      if (open === events) events.onOpen();
    });
    const end = () => {
      if (open === events) open = null;
    };
    return Promise.resolve({ stop: end, cancel: end });
  },
};
