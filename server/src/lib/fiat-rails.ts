import { randomUUID } from "node:crypto";
import { env } from "../env.ts";

export type FiatRailMode = "disabled" | "sandbox" | "live";
export type TransferKind = "deposit" | "withdraw";
export type TransferStatus = "pending" | "complete" | "failed";

export interface FiatTransfer {
  id: string;
  kind: TransferKind;
  amountUsd: string;
  status: TransferStatus;
  createdAt: string;
  updatedAt: string;
  /** Safe copy only: never return a bank account/routing number. */
  message: string;
  recoveryAction?: "retry" | "contact_support";
}

interface SandboxAccount {
  linked: boolean;
  transfers: FiatTransfer[];
}

// Intentionally process-local: this adapter is for local/sandbox UI and E2E
// only. Live provider records and webhook idempotency must be persisted before
// FIAT_RAILS_MODE=live is enabled.
const sandboxAccounts = new Map<string, SandboxAccount>();
const COMPLETE_AFTER_MS = 1200;

export class FiatRailsUnavailableError extends Error {}

export function fiatRailsMode(): FiatRailMode {
  return env.FIAT_RAILS_MODE;
}

function sandboxAccount(userId: string): SandboxAccount {
  let account = sandboxAccounts.get(userId);
  if (!account) {
    account = { linked: false, transfers: [] };
    sandboxAccounts.set(userId, account);
  }
  return account;
}

function refresh(transfer: FiatTransfer): FiatTransfer {
  if (
    transfer.status === "pending" &&
    Date.now() - Date.parse(transfer.createdAt) >= COMPLETE_AFTER_MS
  ) {
    transfer.status = "complete";
    transfer.updatedAt = new Date().toISOString();
    transfer.message =
      transfer.kind === "deposit" ? "Funds are ready to trade." : "Sent to your bank.";
    delete transfer.recoveryAction;
  }
  return transfer;
}

function requireSandbox(): void {
  if (fiatRailsMode() === "sandbox") return;
  if (fiatRailsMode() === "live") {
    throw new FiatRailsUnavailableError(
      "Fiat rails are awaiting the production provider adapter and webhook verification.",
    );
  }
  throw new FiatRailsUnavailableError("Deposits and withdrawals are not available yet.");
}

export function getFiatRailState(userId: string): {
  mode: FiatRailMode;
  bankLinked: boolean;
  transfers: FiatTransfer[];
} {
  if (fiatRailsMode() !== "sandbox")
    return { mode: fiatRailsMode(), bankLinked: false, transfers: [] };
  const account = sandboxAccount(userId);
  return { mode: "sandbox", bankLinked: account.linked, transfers: account.transfers.map(refresh) };
}

/** Sandbox stand-in for Plaid Link's `onSuccess` callback. */
export function linkSandboxBank(userId: string): { bankLinked: true } {
  requireSandbox();
  sandboxAccount(userId).linked = true;
  return { bankLinked: true };
}

export function createSandboxTransfer(
  userId: string,
  kind: TransferKind,
  amountUsd: string,
): FiatTransfer {
  requireSandbox();
  const account = sandboxAccount(userId);
  if (!account.linked)
    throw new FiatRailsUnavailableError("Connect a bank account before moving dollars.");
  const now = new Date().toISOString();
  const transfer: FiatTransfer = {
    id: randomUUID(),
    kind,
    amountUsd,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    message: kind === "deposit" ? "Your bank transfer is pending." : "Your withdrawal is pending.",
    recoveryAction: "retry",
  };
  account.transfers.unshift(transfer);
  return transfer;
}
