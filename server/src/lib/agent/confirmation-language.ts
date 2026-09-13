/**
 * Phase 8 / A-032 — does the user's own message explicitly confirm the
 * pending action? Checked in code against the raw message, the same idiom
 * as `messageAuthorizesForce` (`lib/force-attestation.ts`) and
 * `messageAttestsCapRaise` (`lib/agent-wallet.ts`): the model never decides
 * what counts as consent.
 *
 * Deliberately conservative. "maybe", "looks good", "interesting",
 * "probably", "I think so", a question mark, or a negation anywhere in the
 * message means NOT confirmed — a false negative costs one round trip
 * ("say 'confirm' to place the trade"); a false positive moves money.
 */

const CONFIRM_PATTERNS: readonly RegExp[] = [
  /^\s*(yes[,.!]?\s*)?(confirm(ed)?|approve[d]?|authori[sz]e[d]?)\b/i,
  /\b(i )?(confirm|approve|authori[sz]e)( (it|this|the (trade|swap|order|transaction|action)))?\b/i,
  /\b(yes[,.!]?\s*)?(execute|place|submit|do) (it|this|the (trade|swap|order|transaction|action))( now)?\b/i,
  /\b(yes[,.!]?\s*)?go ahead( and (execute|place|submit|do it|trade|swap))?\b/i,
  /\b(yes[,.!]?\s*)?proceed( with (it|this|the (trade|swap|order|transaction)))?\b/i,
  /^\s*yes[,.!]?\s*(please)?\s*$/i,
];

const HEDGE_PATTERNS: readonly RegExp[] = [
  /\bmaybe\b/i,
  /\bperhaps\b/i,
  /\bprobably\b/i,
  /\bpossibly\b/i,
  /\bi (think|guess|suppose)\b/i,
  /\blooks? (good|fine|ok|okay|interesting)\b/i,
  /\bsounds? (good|fine|ok|okay|interesting)\b/i,
  /\binteresting\b/i,
  /\bnot sure\b/i,
  /\blater\b/i,
  /\bwait\b/i,
  /\bhold (on|off)\b/i,
  /\bwhat if\b/i,
  /\bshould i\b/i,
  /\bcould you\b/i,
  /\?/,
];

const NEGATION_PATTERNS: readonly RegExp[] = [
  /\b(don'?t|do not|never|no[,.]? |cancel|stop|abort|nevermind|never mind|not now)\b/i,
];

/** True only when the message is an unambiguous, unhedged, unnegated confirmation. */
export function messageConfirmsAction(message: string): boolean {
  const text = message.trim();
  if (text.length === 0 || text.length > 400) return false;
  if (NEGATION_PATTERNS.some((re) => re.test(text))) return false;
  if (HEDGE_PATTERNS.some((re) => re.test(text))) return false;
  return CONFIRM_PATTERNS.some((re) => re.test(text));
}
