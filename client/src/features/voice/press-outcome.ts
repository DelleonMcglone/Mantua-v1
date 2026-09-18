/**
 * Task 069 (V-006, V-007, V-009, V-010) — what one finished press amounts
 * to, decided in one place.
 *
 * The hook owns timing; this owns the verdict. Every rule about a press
 * that should not become a command converges here, so the whole decision
 * can be read — and tested — as a single function rather than inferred
 * from the order of branches inside an effect.
 */
import { judgeActivation, MIN_PRESS_MS } from "./activation-core.ts";
import { applyCorrections } from "./correction-core.ts";
import { speechIsAssentOnly } from "./confirm-guard.ts";
import { NO_SPEECH_NOTICE, SPOKEN_CONFIRM_NOTICE } from "./voice-status-core.ts";
import type { Transcript } from "./voice-types.ts";

/** How long to wait after release for the tail of a sentence to settle. */
export const SETTLE_MS = 900;

/**
 * Whether a released press can be judged at once instead of waiting out
 * the settle window.
 *
 * Two cases need no wait. A press too brief to hold a word has nothing
 * coming, and waiting would leave the button unusable for most of a
 * second — exactly when someone who mis-pressed tries again (V-007). And
 * an empty partial with committed text behind it means the server already
 * settled everything it heard, so there is nothing still in flight.
 */
export function settleImmediately(input: { pressMs: number; transcript: Transcript }): boolean {
  if (input.pressMs < MIN_PRESS_MS) return true;
  return input.transcript.partial === "" && input.transcript.committed !== "";
}

export type PressOutcome =
  /** The user's command, corrections applied. Submit it. */
  | { kind: "submit"; text: string }
  /** Nothing usable was heard. Show the line and submit nothing. */
  | { kind: "notice"; notice: string }
  /** A slip. Say nothing at all. */
  | { kind: "quiet" };

/**
 * Judges a completed press.
 *
 * @param input.pressMs how long the button was held
 * @param input.text the committed transcript, which is all that counts —
 *   a partial the model never settled is a guess it abandoned
 */
export function resolvePress(input: { pressMs: number; text: string }): PressOutcome {
  const verdict = judgeActivation(input);
  if (verdict.kind === "discard") return { kind: "quiet" };
  if (verdict.kind === "retry") return { kind: "notice", notice: NO_SPEECH_NOTICE };

  const spoken = applyCorrections(verdict.text);
  if (spoken === "") return { kind: "quiet" };

  // V-009: speech is never consent. The server refuses to mint a
  // confirmation from a spoken turn regardless; saying so here is what
  // stops the user believing they just confirmed something.
  if (speechIsAssentOnly(spoken)) return { kind: "notice", notice: SPOKEN_CONFIRM_NOTICE };

  return { kind: "submit", text: spoken };
}
