/**
 * Task 069 (V-006) — the second kind of correction: the speaker changing
 * their own mind mid-sentence.
 *
 * The rule is deliberately narrow. Guessing broadly at what someone meant
 * to say is how a voice interface puts words in a user's mouth, so only
 * two shapes are recognised, and anything else is left exactly as spoken:
 *
 *   - **A restart** ("scratch that", "never mind") drops everything before
 *     the marker. What follows is the whole command.
 *   - **An amount change** ("fifty — no, make that twenty") replaces the
 *     last amount before the marker with the first amount after it, when
 *     both sides have one. Corrections apply left to right, so a speaker
 *     who changes their mind twice ends up with their last figure.
 *
 * Everything else — a marker with no amount after it, a sentence with no
 * marker at all — returns the text unchanged. The corrected line is shown
 * to the user as the message they sent, so a wrong guess is visible rather
 * than silent.
 */

/** Markers that throw away everything said before them. */
const RESTART = /\b(?:scratch that|start over|start again|forget (?:that|it)|never mind)\b/i;

/** Markers that replace a value rather than the whole utterance. */
const REPLACE =
  /\b(?:no,?\s*(?:wait,?\s*)?(?:sorry,?\s*)?make (?:that|it)|sorry,?\s*make (?:that|it)|i meant|i mean|sorry,?\s*i meant)\b/i;

/** A spoken amount: digits, or one of the number words a trade uses. */
const NUMBER_WORDS =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand";
const AMOUNT = new RegExp(String.raw`\$?\d[\d,]*(?:\.\d+)?|\b(?:${NUMBER_WORDS})\b`, "i");

/** A speaker can only change their mind so many times in one breath. */
const MAX_CORRECTIONS = 8;

function firstMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  return new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(text);
}

function lastMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  const re = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  let found: RegExpExecArray | null = null;
  let match = re.exec(text);
  while (match !== null) {
    found = match;
    match = re.exec(text);
  }
  return found;
}

/** Applies one replacement marker, or returns null when it corrects nothing. */
function applyOne(text: string): string | null {
  const marker = firstMatch(text, REPLACE);
  if (!marker) return null;

  const head = text.slice(0, marker.index);
  const tail = text.slice(marker.index + marker[0].length);

  const replacement = firstMatch(tail, AMOUNT);
  const target = lastMatch(head, AMOUNT);
  if (!replacement || !target) return null;

  const corrected =
    head.slice(0, target.index) + replacement[0] + head.slice(target.index + target[0].length);
  return corrected + tail.slice(replacement.index + replacement[0].length);
}

/**
 * Applies a speaker's self-correction.
 *
 * @param spoken the transcript exactly as the model committed it
 * @returns the corrected command, or `spoken` tidied but otherwise
 *   unchanged when no correction shape is recognised
 */
export function applyCorrections(spoken: string): string {
  const restart = lastMatch(spoken, RESTART);
  let text = restart ? spoken.slice(restart.index + restart[0].length) : spoken;

  for (let i = 0; i < MAX_CORRECTIONS; i += 1) {
    const next = applyOne(text);
    if (next === null) break;
    text = next;
  }
  return tidy(text);
}

/** Collapses the whitespace and stray punctuation a cut leaves behind. */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/^[\s,.;:—-]+/, "")
    .replace(/[\s,;:—-]+$/, "")
    .trim();
}
