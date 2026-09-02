/**
 * Code-level gate for the swap tool's `force` override.
 *
 * The override was previously authorized purely at the prompt layer — the
 * model decided whether the user "explicitly insisted". This helper moves
 * that judgment into code: force=true is only honored when the user's
 * CURRENT message contains unambiguous override language, checked against
 * the raw message text server-side.
 *
 * Deliberately conservative: generic consent ("yes", "go ahead", "sounds
 * good") does NOT arm the override — the user must use wording that can only
 * mean "skip the guard". False negatives cost one clarifying round-trip
 * ("say 'force the swap' if you really want this"); false positives execute
 * a trade the guard said was unsafe.
 */
const FORCE_PATTERNS: readonly RegExp[] = [
  /\bforce\b/i,
  /\boverride\b/i,
  /\binsist\b/i,
  /\b(do|swap|send|execute|trade|proceed|go ahead) (it |the swap |them |both )?anyway\b/i,
  /\bskip the guard\b/i,
  /\bbypass the (guard|check|safety)\b/i,
  /\bignore the (guard|risk|warning|impact)\b/i,
  /\baccept the (risk|loss|impact|slippage)\b/i,
];

/** True when the user's message explicitly authorizes a guard override. */
export function messageAuthorizesForce(message: string): boolean {
  return FORCE_PATTERNS.some((re) => re.test(message));
}
