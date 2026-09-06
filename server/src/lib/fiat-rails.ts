import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/users.ts";
import { env } from "../env.ts";
import { logAudit } from "./audit.ts";
import { dbFiatStore, type FiatStore, type FiatTransferRecord } from "./fiat-store.ts";
import {
  fiatTransferMessage,
  type FiatRecoveryAction,
  type FiatTransferKind,
  type FiatTransferStatus,
  type FiatTransitionPatch,
} from "./fiat-transfers.ts";
import { logger } from "./logger.ts";
import { createPlaidLinkToken, exchangePublicToken, plaidConfigured } from "./plaid-fiat.ts";
import {
  createZhExternalAccount,
  createZhPayment,
  ensureZhParticipant,
  executeZhConversion,
  requestZhUsdcDelivery,
  zeroHashConfigured,
} from "./zerohash.ts";

/**
 * F-003/F-004/F-006 — fiat rails orchestration (D-101).
 *
 * Zero Hash is the regulated counterparty: USD↔USDC conversion, ACH/RTP
 * movement, KYC/AML. Plaid links the bank. Mantua orchestrates and keeps a
 * durable `fiat_transfers` ledger — it never touches bank account numbers
 * and never holds customer fiat.
 *
 * Modes (FIAT_RAILS_MODE):
 *   disabled — production-safe default; every endpoint 503s.
 *   sandbox  — deterministic local adapter; transfers persist to
 *              `fiat_transfers` and auto-complete after ~1.2s via the same
 *              one-way state machine the live path uses. Optionally uses
 *              REAL Plaid sandbox Link when Plaid creds are present.
 *   live     — full Plaid + Zero Hash orchestration; requires both
 *              credential sets, else fails closed.
 */

export type FiatRailMode = "disabled" | "sandbox" | "live";
export type TransferKind = FiatTransferKind;
export type TransferStatus = FiatTransferStatus;

export interface FiatTransfer {
  id: string;
  kind: TransferKind;
  amountUsd: string;
  status: TransferStatus;
  createdAt: string;
  updatedAt: string;
  /** Safe copy only: never a bank account/routing number. */
  message: string;
  recoveryAction?: FiatRecoveryAction;
}

export class FiatRailsUnavailableError extends Error {}

/** Sandbox pendings auto-complete after this long (lazy, on next read). */
const SANDBOX_COMPLETE_AFTER_MS = 1200;

// Injectable store so the sandbox flow is unit-testable without Postgres.
let store: FiatStore = dbFiatStore;
export function _setFiatStoreForTests(next: FiatStore | null): void {
  store = next ?? dbFiatStore;
}

let modeOverride: FiatRailMode | null = null;
/** Test seam — never used in production code paths. */
export function _setFiatRailsModeForTests(mode: FiatRailMode | null): void {
  modeOverride = mode;
}

export function fiatRailsMode(): FiatRailMode {
  return modeOverride ?? env.FIAT_RAILS_MODE;
}

function requireEnabled(): FiatRailMode {
  const mode = fiatRailsMode();
  if (mode === "disabled") {
    throw new FiatRailsUnavailableError("Deposits and withdrawals are not available yet.");
  }
  if (mode === "live" && !zeroHashConfigured()) {
    // Live fails closed until the Zero Hash platform agreement is executed
    // and credentials are provisioned (F-001, operator-side).
    throw new FiatRailsUnavailableError("Fiat rails are awaiting production provider credentials.");
  }
  return mode;
}

function toView(row: FiatTransferRecord): FiatTransfer {
  return {
    id: row.id,
    kind: row.kind,
    amountUsd: row.amountUsd,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    message:
      row.status === "failed" && row.failureReason
        ? row.failureReason
        : fiatTransferMessage(row.kind, row.status),
    ...(row.recoveryAction ? { recoveryAction: row.recoveryAction as FiatRecoveryAction } : {}),
  };
}

/**
 * The ONE place a persisted transfer changes status. Applies the one-way
 * transition through the store (conditional at the row level) and writes
 * the `fiat_transfer` audit row for every applied change.
 */
export async function applyFiatTransition(params: {
  transferId: string;
  to: FiatTransferStatus;
  patch?: FiatTransitionPatch;
  source: "sandbox_tick" | "provider_sync" | "webhook" | "orchestrator";
}): Promise<FiatTransferRecord | null> {
  const row = await store.transition(params.transferId, params.to, params.patch);
  if (!row) return null;
  await logAudit({
    action: "fiat_transfer",
    outcome: params.to === "failed" ? "failure" : params.to === "complete" ? "success" : "pending",
    params: {
      transferId: row.id,
      kind: row.kind,
      amountUsd: row.amountUsd,
      status: row.status,
      provider: row.provider,
      source: params.source,
      ...(row.zhTransferId ? { zhTransferId: row.zhTransferId } : {}),
    },
    ...(row.failureReason ? { reason: row.failureReason } : {}),
  });
  return row;
}

/** Lazy sandbox tick: settle overdue sandbox pendings, with audit rows. */
async function tickSandbox(userId: string): Promise<void> {
  const completed = await store.completeStaleSandboxPendings(userId, SANDBOX_COMPLETE_AFTER_MS);
  for (const row of completed) {
    await logAudit({
      action: "fiat_transfer",
      outcome: "success",
      params: {
        transferId: row.id,
        kind: row.kind,
        amountUsd: row.amountUsd,
        status: row.status,
        provider: row.provider,
        source: "sandbox_tick",
      },
    });
  }
}

export interface FiatRailState {
  mode: FiatRailMode;
  bankLinked: boolean;
  /** Real Plaid Link is available (server creates link tokens). */
  plaidReady: boolean;
  /** Display-safe bank label, e.g. "First Platypus Bank ••1234". */
  bankLabel: string | null;
  transfers: FiatTransfer[];
}

export async function getFiatRailState(privyUserId: string): Promise<FiatRailState> {
  const mode = fiatRailsMode();
  if (mode === "disabled") {
    return { mode, bankLinked: false, plaidReady: false, bankLabel: null, transfers: [] };
  }
  const userId = await store.ensureUser(privyUserId);
  await tickSandbox(userId);
  const [link, transfers] = await Promise.all([
    store.getBankLink(userId),
    store.listTransfers(userId),
  ]);
  const linked = link?.status === "active";
  const bankLabel =
    linked && link.institutionName
      ? `${link.institutionName}${link.accountMask ? ` ••${link.accountMask}` : ""}`
      : null;
  return {
    mode,
    bankLinked: linked,
    plaidReady: plaidConfigured(),
    bankLabel,
    transfers: transfers.map(toView),
  };
}

/** Sandbox stand-in for Plaid Link — used when Plaid creds are absent. */
export async function linkSandboxBank(privyUserId: string): Promise<{ bankLinked: true }> {
  const mode = fiatRailsMode();
  if (mode !== "sandbox") {
    throw new FiatRailsUnavailableError(
      mode === "live"
        ? "Connect your bank through the secure bank-link flow."
        : "Deposits and withdrawals are not available yet.",
    );
  }
  const userId = await store.ensureUser(privyUserId);
  await store.upsertBankLink({
    userId,
    provider: "sandbox",
    status: "active",
    institutionName: "Sandbox Bank",
    accountMask: "0000",
  });
  return { bankLinked: true };
}

/** F-002 — create a Plaid Link token for the authed user (server-only). */
export async function createFiatLinkToken(privyUserId: string): Promise<{ linkToken: string }> {
  requireEnabled();
  if (!plaidConfigured()) {
    throw new FiatRailsUnavailableError("Bank linking is not available yet.");
  }
  const userId = await store.ensureUser(privyUserId);
  return { linkToken: await createPlaidLinkToken(userId) };
}

/**
 * F-002 — complete the bank link from Plaid Link's `onSuccess` public token.
 *
 * Server-side only: exchanges the public token (the access token stays
 * transient inside plaid-fiat.ts — D-101), mints the Zero Hash processor
 * token, and — when Zero Hash is configured — creates the participant and
 * external account. What is stored: provider references + display metadata.
 */
export async function completeBankLinkExchange(
  privyUserId: string,
  publicToken: string,
): Promise<{ bankLinked: true }> {
  requireEnabled();
  if (!plaidConfigured()) {
    throw new FiatRailsUnavailableError("Bank linking is not available yet.");
  }
  const userId = await store.ensureUser(privyUserId);
  const exchange = await exchangePublicToken(publicToken);

  let zhParticipantCode: string | null = null;
  let zhExternalAccountId: string | null = null;
  if (zeroHashConfigured()) {
    const email = await userEmail(userId);
    const participant = await ensureZhParticipant({
      email: email ?? `${userId}@users.mantua.internal`,
      clientRef: userId,
    });
    zhParticipantCode = participant.participant_code;
    const external = await createZhExternalAccount({
      participantCode: participant.participant_code,
      plaidProcessorToken: exchange.processorToken, // transient — not stored
      accountNickname: exchange.institutionName ?? "Linked bank",
      clientRef: exchange.plaidItemId,
    });
    zhExternalAccountId = external.external_account_id;
  } else {
    // Sandbox-with-Plaid without Zero Hash creds: the Plaid half is real,
    // the Zero Hash half activates when credentials land (F-001).
    logger.info({ userId }, "fiat: bank linked via Plaid; Zero Hash not configured yet");
  }

  await store.upsertBankLink({
    userId,
    provider: "plaid",
    status: "active",
    plaidItemId: exchange.plaidItemId,
    zhParticipantCode,
    zhExternalAccountId,
    institutionName: exchange.institutionName,
    accountMask: exchange.accountMask,
  });
  return { bankLinked: true };
}

async function userEmail(userId: string): Promise<string | null> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows.at(0)?.email ?? null;
}

async function userWalletAddress(userId: string): Promise<string | null> {
  const rows = await db
    .select({ primaryAddress: users.primaryAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows.at(0)?.primaryAddress ?? null;
}

/**
 * F-004 — create a deposit or withdrawal.
 *
 * Sandbox: persists a pending `fiat_transfers` row; the lazy tick completes
 * it. Live: orchestrates Zero Hash —
 *
 *   deposit  = ACH/RTP debit from the linked bank → USD→USDC conversion →
 *              USDC delivered to the USER'S wallet address (never the agent
 *              wallet), on the network named by FIAT_USDC_NETWORK (D-112).
 *   withdraw = USDC→USD conversion → ACH/RTP credit to the linked bank.
 *
 * Every provider call carries the row's idempotency key, so a retry after
 * a crash cannot double-move money. Spending-cap note: fiat deposits are
 * INFLOWS and withdrawals move the user's own fiat balance — neither is an
 * agent spend, so the P1-001 spending cap deliberately does not apply.
 */
export async function createFiatTransfer(
  privyUserId: string,
  kind: TransferKind,
  amountUsd: string,
): Promise<FiatTransfer> {
  const mode = requireEnabled();
  const userId = await store.ensureUser(privyUserId);
  const link = await store.getBankLink(userId);
  if (!link || link.status !== "active") {
    throw new FiatRailsUnavailableError("Connect a bank account before moving dollars.");
  }

  if (mode === "sandbox" && (link.provider === "sandbox" || !zeroHashConfigured())) {
    const row = await store.insertTransfer({
      userId,
      kind,
      amountUsd,
      provider: "sandbox",
      idempotencyKey: randomUUID(),
    });
    return toView(row);
  }

  // Live orchestration (also used in sandbox mode against Zero Hash CERT
  // when credentials are present — same code path, cert host).
  if (!link.zhParticipantCode || !link.zhExternalAccountId) {
    throw new FiatRailsUnavailableError("Your bank link is still being verified.");
  }
  const idempotencyKey = randomUUID();
  const row = await store.insertTransfer({
    userId,
    kind,
    amountUsd,
    provider: "zerohash",
    idempotencyKey,
    zhParticipantCode: link.zhParticipantCode,
  });

  try {
    if (kind === "deposit") {
      // 1. Pull USD from the bank. Zero Hash settles the ACH/RTP leg and
      //    emits webhooks as it moves.
      const payment = await createZhPayment({
        participantCode: link.zhParticipantCode,
        externalAccountId: link.zhExternalAccountId,
        amountUsd,
        direction: "debit",
        idempotencyKey,
      });
      await applyFiatTransition({
        transferId: row.id,
        to: "processing",
        patch: { zhTransferId: payment.payment_id, providerStatus: payment.status ?? "created" },
        source: "orchestrator",
      });
      // 2. Convert USD → USDC once funds post (webhook-driven in
      //    production; the conversion + delivery below are initiated
      //    eagerly in cert where funding is instant).
      await executeZhConversion({
        participantCode: link.zhParticipantCode,
        amountUsd,
        side: "buy",
        idempotencyKey: `${idempotencyKey}-convert`,
      });
      // 3. Deliver USDC to the user's own wallet (D-112: network from
      //    config, never hardcoded).
      const destination = await userWalletAddress(userId);
      if (destination) {
        await requestZhUsdcDelivery({
          participantCode: link.zhParticipantCode,
          destinationAddress: destination,
          amountUsdc: amountUsd,
          idempotencyKey: `${idempotencyKey}-deliver`,
        });
      }
    } else {
      // Withdraw: USDC → USD, then ACH/RTP credit to the linked bank.
      await executeZhConversion({
        participantCode: link.zhParticipantCode,
        amountUsd,
        side: "sell",
        idempotencyKey: `${idempotencyKey}-convert`,
      });
      const payment = await createZhPayment({
        participantCode: link.zhParticipantCode,
        externalAccountId: link.zhExternalAccountId,
        amountUsd,
        direction: "credit",
        idempotencyKey,
      });
      await applyFiatTransition({
        transferId: row.id,
        to: "processing",
        patch: { zhTransferId: payment.payment_id, providerStatus: payment.status ?? "created" },
        source: "orchestrator",
      });
    }
  } catch (err) {
    const failed = await applyFiatTransition({
      transferId: row.id,
      to: "failed",
      patch: {
        failureReason:
          kind === "deposit"
            ? "Your deposit didn’t go through."
            : "Your withdrawal didn’t go through.",
        recoveryAction: "retry",
      },
      source: "orchestrator",
    });
    logger.error({ err, transferId: row.id }, "fiat: provider orchestration failed");
    if (failed) return toView(failed);
    throw err;
  }

  const fresh = (await store.listTransfers(userId, 5)).find((t) => t.id === row.id) ?? row;
  return toView(fresh);
}

// Legacy sandbox helpers kept for the existing route/test surface.
export async function createSandboxTransfer(
  privyUserId: string,
  kind: TransferKind,
  amountUsd: string,
): Promise<FiatTransfer> {
  return createFiatTransfer(privyUserId, kind, amountUsd);
}
