/**
 * Task 069 (V-009) — the client half of "voice cannot confirm".
 *
 * The binding half is on the server: `buildTurnContext` refuses to mint a
 * confirmation for a message it was told arrived by voice, so speech
 * cannot execute anything even if this file were deleted. What this adds
 * is honesty at the moment it matters — a user who says "confirm" and
 * watches the word land in the chat would reasonably believe they had
 * confirmed. Catching the utterance here means they are told instead.
 *
 * The test is deliberately narrow: only an utterance that is *nothing but*
 * assent. "Yes, show me tonight's games" is a command and goes through
 * untouched; a bare "yes" while a trade is on screen does not.
 */

/** An utterance that carries assent and no other instruction. */
const ASSENT_ONLY =
  /^(?:yes|yeah|yep|yup|ok|okay|sure|confirm|confirmed|do it|go ahead|send it|execute|approve|accept|that's right|correct)\s*[.!]*$/i;

/**
 * True when this spoken text would read as a confirmation and nothing
 * else, so submitting it would mislead the speaker about what happened.
 */
export function speechIsAssentOnly(spoken: string): boolean {
  return ASSENT_ONLY.test(spoken.trim());
}
