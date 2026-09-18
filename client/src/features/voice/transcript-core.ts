/**
 * Task 069 (V-003, V-006) — assembling what the model says into what the
 * user sees.
 *
 * Scribe streams two kinds of message. A `partial_transcript` is the
 * model's current guess at the words being spoken now, and it is replaced
 * wholesale each time it revises — that replacement is the first of the two
 * corrections V-006 asks for. A `committed_transcript` is settled text that
 * will not change, and it appends.
 *
 * Rendered by MicButton.tsx and InputBar.tsx.
 */
import type { Transcript } from "./voice-types.ts";

export const EMPTY_TRANSCRIPT: Transcript = { committed: "", partial: "" };

/**
 * Joins two spoken fragments. Speech has no spaces of its own, so a space
 * goes between them unless one side already supplies the separation or the
 * next fragment opens with punctuation that should hug the previous word.
 */
export function joinSpoken(head: string, tail: string): string {
  const left = head.replace(/\s+$/, "");
  const right = tail.replace(/^\s+/, "");
  if (left === "") return right;
  if (right === "") return left;
  if (/^[,.!?;:%)\]]/.test(right)) return left + right;
  return `${left} ${right}`;
}

/** The model revised its guess at the words still in the air. */
export function applyPartial(transcript: Transcript, text: string): Transcript {
  return { committed: transcript.committed, partial: text.trim() };
}

/**
 * The model settled a segment. It joins the committed text and clears the
 * partial, because the words it covered are no longer provisional.
 */
export function applyCommitted(transcript: Transcript, text: string): Transcript {
  const settled = text.trim();
  if (settled === "") return { committed: transcript.committed, partial: "" };
  return { committed: joinSpoken(transcript.committed, settled), partial: "" };
}

/** Everything heard so far, settled and provisional, as one line. */
export function transcriptText(transcript: Transcript): string {
  return joinSpoken(transcript.committed, transcript.partial).trim();
}

/**
 * What a finished session yields. Only committed text counts: a partial
 * the model never settled is a guess it abandoned, and submitting a guess
 * the user did not hear settle would put words in their mouth.
 */
export function finalText(transcript: Transcript): string {
  return transcript.committed.trim();
}

export function isEmpty(transcript: Transcript): boolean {
  return transcriptText(transcript) === "";
}
