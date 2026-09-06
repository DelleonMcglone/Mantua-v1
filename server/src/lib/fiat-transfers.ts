/**
 * F-006 — fiat transfer state machine.
 *
 * The SINGLE source of truth for fiat transfer status transitions. Both
 * store implementations (Postgres in fiat-store.ts, the in-memory test
 * store) derive their transition guards from `FIAT_TRANSFER_PRIOR_STATUSES`
 * — there is no second copy of the rules anywhere.
 *
 * The machine is strictly one-way:
 *
 *   pending ──→ processing ──→ complete
 *      │             │
 *      ├─────────────┼──→ failed
 *      └─────────────┴──→ canceled
 *
 * `complete`, `failed` and `canceled` are terminal; nothing leaves them.
 * A transfer can also jump pending → complete directly (sandbox fast-path,
 * RTP same-second settlement).
 */

export type FiatTransferKind = "deposit" | "withdraw";
export type FiatTransferStatus = "pending" | "processing" | "complete" | "failed" | "canceled";
export type FiatRecoveryAction = "retry" | "contact_support";

export const FIAT_TRANSFER_STATUSES: readonly FiatTransferStatus[] = [
  "pending",
  "processing",
  "complete",
  "failed",
  "canceled",
];

/** For each target status, the statuses a row may move FROM. */
export const FIAT_TRANSFER_PRIOR_STATUSES: Record<
  FiatTransferStatus,
  readonly FiatTransferStatus[]
> = {
  pending: [], // initial state only — nothing transitions INTO pending
  processing: ["pending"],
  complete: ["pending", "processing"],
  failed: ["pending", "processing"],
  canceled: ["pending", "processing"],
};

export function isTerminalFiatStatus(status: FiatTransferStatus): boolean {
  return status === "complete" || status === "failed" || status === "canceled";
}

export function canTransitionFiatTransfer(
  from: FiatTransferStatus,
  to: FiatTransferStatus,
): boolean {
  return FIAT_TRANSFER_PRIOR_STATUSES[to].includes(from);
}

/** Patch applied alongside a status transition. Provider references only —
 *  never bank account numbers (D-101). */
export interface FiatTransitionPatch {
  providerStatus?: string | undefined;
  failureReason?: string | undefined;
  recoveryAction?: FiatRecoveryAction | undefined;
  zhTransferId?: string | undefined;
}

/**
 * User-facing copy for a transfer state. Chainless by design (F-005): no
 * wallet/bridge/gas/network words — the user sees dollars and clear status.
 */
export function fiatTransferMessage(kind: FiatTransferKind, status: FiatTransferStatus): string {
  switch (status) {
    case "pending":
      return kind === "deposit" ? "Your bank transfer is pending." : "Your withdrawal is pending.";
    case "processing":
      return kind === "deposit"
        ? "Your deposit is on its way."
        : "Your withdrawal is on its way to your bank.";
    case "complete":
      return kind === "deposit" ? "Funds are ready to trade." : "Sent to your bank.";
    case "failed":
      return kind === "deposit"
        ? "Your deposit didn’t go through."
        : "Your withdrawal didn’t go through.";
    case "canceled":
      return kind === "deposit" ? "Deposit canceled." : "Withdrawal canceled.";
  }
}
