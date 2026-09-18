/**
 * Task 069 (V-010) — translating the two things that can refuse a session
 * into the one vocabulary the rest of the feature speaks.
 *
 * Kept out of the transport so the mapping is readable and testable while
 * the transport itself stays a thin piece of wiring around browser APIs.
 */
import { ApiError } from "@/lib/api.ts";
import type { VoiceFailure } from "./voice-types.ts";

/** Our own token route's refusal. */
export function failureForApiError(err: unknown): VoiceFailure {
  if (!(err instanceof ApiError)) return "unavailable";
  switch (err.code) {
    case "VOICE_DISABLED":
      return "not_configured";
    case "VOICE_QUOTA":
      return "quota";
    case "RATE_LIMITED":
      return "rate_limited";
    default:
      return "unavailable";
  }
}

/**
 * A `getUserMedia` rejection. The DOM names these as exception classes, so
 * the name is the only thing worth reading — a message would be the
 * browser's own wording in the browser's own locale.
 */
export function failureForMediaError(err: unknown): VoiceFailure {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "permission_denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no_device";
  return "unavailable";
}

/** Microphone frames as the socket wants them: base64 of the PCM bytes. */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
