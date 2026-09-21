/**
 * C-017 — Gas Station sponsorship configuration.
 *
 * Circle sponsors DCW SCA transactions automatically when an ACTIVE policy
 * covers the chain: the DCW OpenAPI transaction requests carry only fee
 * fields (feeLevel/gasLimit/gasPrice/maxFee/priorityFee) — there is no
 * sponsorship argument to pass a policy id to — and Circle exposes no API
 * to read a policy back (GET /v1/gasSponsorship/policies 404s, unlike real
 * endpoints which 401). What the API DOES offer is `refId`, a free-form
 * reference stamped on every created transaction and visible in the
 * console's per-policy sponsored-transactions table.
 *
 * So consuming the operator's CIRCLE_GAS_STATION_POLICY_ID means three
 * things, mirroring the C-016 pattern for CIRCLE_WALLET_SET_ID:
 *
 *   1. Boot — env.ts requires a configured id to be a UUID, and WARNS in
 *      every environment when it is unset (circleDegradations). It does not
 *      fail the boot: the whole read surface would go down for a setting
 *      only the agent needs, and step 2 already refuses the transaction.
 *   2. Runtime — the executors stamp the policy id onto every transaction
 *      via `refId` (the audit link from a Circle transaction back to the
 *      policy that sponsored it), and production refuses to create a
 *      transaction that Gas Station cannot sponsor — an unsponsored SCA
 *      wallet with no ETH fails as an opaque timeout.
 *   3. Preflight — scripts/circle-preflight.ts verifies the sponsorship
 *      dependencies that ARE reachable over the API (wallet set live,
 *      BASE wallets) and prints the console-only policy check (active +
 *      default status is console-side; there is no read API).
 */

import { env } from "../../env.ts";

/** Raised in production when a transaction would be created unsponsored. */
export class SponsorshipNotConfiguredError extends Error {
  constructor() {
    super(
      "CIRCLE_GAS_STATION_POLICY_ID is not set — refusing to create an agent transaction that Gas Station cannot sponsor (an SCA wallet holding no ETH fails as an opaque timeout). Record the policy id from Console → Gas Station in env and redeploy.",
    );
    this.name = "SponsorshipNotConfiguredError";
  }
}

/** The recorded Gas Station policy id, or null when unset/blank. */
export function getGasStationPolicyId(): string | null {
  const id = env.CIRCLE_GAS_STATION_POLICY_ID?.trim();
  return id ? id : null;
}

/**
 * Circle `refId` stamped on every transaction created while the recorded
 * policy governs sponsorship. Circle's console shows sponsored transactions
 * per policy, so `gas-station:<id>` is the operator's closed loop: if a
 * transaction created by this code does not appear under the recorded
 * policy, the recorded id is not the policy sponsoring the code.
 */
export function sponsorshipRefId(): string | null {
  const id = getGasStationPolicyId();
  return id ? `gas-station:${id}` : null;
}

/**
 * Production runtime guard — the same "second line of defence" the wallet
 * set carries in client.ts: boot-time validation in env.ts catches a missing
 * id at deploy time, and this catches a runtime env mutation before an
 * unsponsored transaction is created.
 */
export function assertSponsorshipConfigured(): void {
  if (env.NODE_ENV === "production" && !getGasStationPolicyId()) {
    throw new SponsorshipNotConfiguredError();
  }
}
