import { UserNotFoundError } from "./agent-wallet.ts";
import { CircleUnavailableError } from "./circle/client.ts";
import { CustodyUnprovisionedError } from "./custody/custody-wallet-set.ts";

/**
 * What the agent chat tells a user when provisioning their agent wallet
 * fails. The chat stream used to collapse every failure into "The agent hit
 * an unexpected error." — a Circle outage, a brand-new account whose own
 * wallet was not ready, and a code bug all read the same, with nothing to
 * act on. The cause stays in the server log (`reason`); the user gets a
 * sentence that says what to do.
 */
export function describeWalletProvisionError(err: unknown): { message: string; reason: string } {
  if (err instanceof UserNotFoundError) {
    return {
      reason: "user_not_found",
      message:
        "Your account is still being set up. Give it a few seconds, then try again. If it keeps happening, log out and back in.",
    };
  }
  if (err instanceof CircleUnavailableError) {
    return {
      reason: "circle_unavailable",
      message: "Agent wallets are temporarily unavailable. Please try again in a few minutes.",
    };
  }
  if (err instanceof CustodyUnprovisionedError) {
    return {
      reason: "custody_unprovisioned",
      message: "Your organisation's agent wallet has not been enabled yet. Contact support.",
    };
  }
  return {
    reason: err instanceof Error ? err.message : "unknown",
    message: "We couldn't set up your agent wallet just now. Please try again in a minute.",
  };
}
