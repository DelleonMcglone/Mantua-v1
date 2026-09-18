/**
 * Task 069 (V-010) — what the user is told when voice does not work, and
 * whether the microphone is worth offering again.
 *
 * Every failure resolves to the same place: the text input the user
 * already had. The only question each one answers is which sentence to
 * show and whether a second press could succeed.
 *
 * Copy here is rendered inside the command bar, which the consumer-copy
 * sweep also covers, so it stays in plain language.
 */
import type { VoiceFailure } from "./voice-types.ts";

/** Shown when a press produced no words at all (V-007). */
export const NO_SPEECH_NOTICE = "I didn't catch that. Hold the button and try again.";

/** Shown when speech alone would have been taken as a confirmation (V-009). */
export const SPOKEN_CONFIRM_NOTICE = "Speaking can't confirm a trade — press Confirm to go ahead.";

/** One sentence per failure, in the user's terms rather than the API's. */
export function noticeFor(failure: VoiceFailure): string {
  switch (failure) {
    case "permission_denied":
      return "Mantua needs permission to use your microphone. You can still type.";
    case "no_device":
      return "No microphone found. You can still type.";
    case "not_configured":
      return "Voice input isn't switched on here. You can still type.";
    case "quota":
      return "The voice allowance is used up for now. You can still type.";
    case "rate_limited":
      return "Too many voice sessions at once. Try again in a moment.";
    case "dropped":
      return "The connection dropped mid-sentence. Anything already heard is kept.";
    case "unavailable":
      return "Voice isn't available right now. You can still type.";
  }
}

/**
 * True when a second press cannot help, so the button should stop being
 * offered for the rest of the visit. A denied permission and a missing
 * device both need something outside the page to change; a dropped socket
 * or a busy service does not.
 */
export function isTerminal(failure: VoiceFailure): boolean {
  return failure === "permission_denied" || failure === "no_device" || failure === "not_configured";
}

/**
 * Whether the user should be invited to try again. The retry offer is the
 * "I didn't catch that" pattern, and it is only ever offered once per
 * press so a failing microphone cannot nag.
 */
export function canRetry(failure: VoiceFailure): boolean {
  return !isTerminal(failure);
}
