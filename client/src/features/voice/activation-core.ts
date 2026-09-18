/**
 * Task 069 (V-007, V-010) — deciding whether a press was a command.
 *
 * Push-to-talk is already most of the answer to accidental activation:
 * there is no wake word to mis-fire and no open microphone. What is left is
 * the press that was not meant as speech — a bumped button, a click that
 * caught nothing, a room that was quiet. Those must submit nothing.
 *
 * The three verdicts differ in what the user is told. A press too brief to
 * hold a word is treated as a slip and passes in silence; a real press that
 * yielded nothing gets the "I didn't catch that" retry; anything else is
 * the user's command and is submitted.
 */

/** Shorter than this and the press cannot have held a word. */
export const MIN_PRESS_MS = 350;

/** Fewer meaningful characters than this is not a command. */
export const MIN_SPEECH_CHARS = 2;

/**
 * What a transcription service emits when it heard sound but no speech.
 * These are artefacts of the model, not things a user said, so a
 * transcript made only of them counts as silence.
 */
const NON_SPEECH = new Set([
  "[blank_audio]",
  "[silence]",
  "[noise]",
  "[music]",
  "(silence)",
  "you",
  "uh",
  "um",
  "hmm",
  "mm",
  "ah",
  "oh",
  "thank you.",
  "thanks for watching!",
]);

export type ActivationVerdict =
  | { kind: "submit"; text: string }
  /** A slip. Nothing is submitted and nothing is said about it. */
  | { kind: "discard" }
  /** A real press that produced no words. Worth telling the user about. */
  | { kind: "retry" };

/**
 * Strips a transcript down to what could be a command: no surrounding
 * punctuation, no model artefacts. Returns the empty string when nothing
 * meaningful is left.
 */
export function meaningfulText(raw: string): string {
  const text = raw.trim();
  if (text === "") return "";
  if (NON_SPEECH.has(text.toLowerCase())) return "";
  const letters = text.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters.length < MIN_SPEECH_CHARS) return "";
  return text;
}

/**
 * Judges one completed press.
 *
 * @param input.pressMs how long the button was held
 * @param input.text the committed transcript for that press
 */
export function judgeActivation(input: { pressMs: number; text: string }): ActivationVerdict {
  if (input.pressMs < MIN_PRESS_MS) return { kind: "discard" };
  const text = meaningfulText(input.text);
  if (text === "") return { kind: "retry" };
  return { kind: "submit", text };
}
