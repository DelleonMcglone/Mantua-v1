/**
 * Task 069 (V-001) — the vocabulary of a failed mint.
 *
 * Every way the token exchange can fail reduces to one of these, each with
 * one HTTP status our own route answers and one sentence the client can
 * show before falling back to typing (V-010). Kept apart from the exchange
 * itself so the mapping reads as the small table it is.
 */

/** Why a mint did not produce a token. */
export type MintFailure =
  | "not_configured"
  | "unauthorized"
  | "quota_exceeded"
  | "rate_limited"
  | "upstream_unavailable";

export type MintOutcome =
  | { status: "ok"; token: string; expiresAt: number; modelId: string }
  | { status: MintFailure; reason: string };

/** Maps an upstream HTTP status onto the failure the client is told about. */
export function failureForStatus(status: number): MintFailure {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "quota_exceeded";
  if (status === 429) return "rate_limited";
  return "upstream_unavailable";
}

/** The HTTP status our own route answers for each outcome. */
export function httpStatusFor(outcome: MintOutcome["status"]): number {
  switch (outcome) {
    case "ok":
      return 200;
    case "not_configured":
      return 503;
    case "unauthorized":
      return 502;
    case "quota_exceeded":
      return 503;
    case "rate_limited":
      return 429;
    case "upstream_unavailable":
      return 502;
  }
}

/** One sentence per failure, in the user's terms rather than the API's. */
export function reasonFor(failure: MintFailure): string {
  switch (failure) {
    case "unauthorized":
      return "The transcription service rejected this deployment's credentials.";
    case "quota_exceeded":
      return "The transcription allowance for this deployment is used up.";
    case "rate_limited":
      return "Too many voice sessions at once. Try again in a moment.";
    default:
      return "The transcription service is unavailable.";
  }
}
