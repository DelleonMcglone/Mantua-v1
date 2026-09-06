import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "../db/client.ts";
import { fiatBankLinks, fiatTransfers, fiatWebhookEvents } from "../db/schema/fiat.ts";
import { users } from "../db/schema/users.ts";
import {
  FIAT_TRANSFER_PRIOR_STATUSES,
  canTransitionFiatTransfer,
  type FiatTransferKind,
  type FiatTransferStatus,
  type FiatTransitionPatch,
} from "./fiat-transfers.ts";

/**
 * F-006 — durable persistence behind the fiat rails (both modes).
 *
 * The interface exists so the sandbox flow is unit-testable without a live
 * Postgres (CI runs with a stub DATABASE_URL): production uses `dbFiatStore`,
 * tests inject `createMemoryFiatStore()`. BOTH implementations derive their
 * transition guard from `FIAT_TRANSFER_PRIOR_STATUSES` in fiat-transfers.ts
 * — the state machine lives in exactly one place.
 *
 * D-101 boundary: every field stored here is a provider REFERENCE
 * (Zero Hash ids, Plaid item id) or display-safe metadata. Raw bank
 * account/routing numbers and Plaid access tokens never reach this layer.
 */

export interface FiatBankLinkRecord {
  userId: string;
  provider: "sandbox" | "plaid";
  status: "active" | "revoked";
  plaidItemId?: string | null;
  zhParticipantCode?: string | null;
  zhExternalAccountId?: string | null;
  institutionName?: string | null;
  accountMask?: string | null;
}

export interface FiatTransferRecord {
  id: string;
  userId: string;
  kind: FiatTransferKind;
  amountUsd: string;
  status: FiatTransferStatus;
  provider: "sandbox" | "zerohash";
  idempotencyKey: string;
  zhTransferId: string | null;
  zhParticipantCode: string | null;
  providerStatus: string | null;
  failureReason: string | null;
  recoveryAction: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface NewFiatTransfer {
  userId: string;
  kind: FiatTransferKind;
  amountUsd: string;
  provider: "sandbox" | "zerohash";
  idempotencyKey: string;
  zhTransferId?: string | undefined;
  zhParticipantCode?: string | undefined;
  providerStatus?: string | undefined;
}

export interface FiatStore {
  /** Upsert a users row by Privy id; returns the internal user id. */
  ensureUser(privyUserId: string): Promise<string>;
  getBankLink(userId: string): Promise<FiatBankLinkRecord | null>;
  upsertBankLink(record: FiatBankLinkRecord): Promise<void>;
  insertTransfer(transfer: NewFiatTransfer): Promise<FiatTransferRecord>;
  listTransfers(userId: string, limit?: number): Promise<FiatTransferRecord[]>;
  getTransferByZhId(zhTransferId: string): Promise<FiatTransferRecord | null>;
  /**
   * One-way status transition — the ONLY way a stored transfer changes
   * status. Applies iff the current status is a legal prior of `to`
   * (conditional UPDATE, so poll/webhook races settle at the row level).
   * Returns the updated row, or null when the transition did not apply.
   */
  transition(
    id: string,
    to: FiatTransferStatus,
    patch?: FiatTransitionPatch,
  ): Promise<FiatTransferRecord | null>;
  /** Sandbox lazy tick: complete sandbox rows pending longer than `olderThanMs`. */
  completeStaleSandboxPendings(userId: string, olderThanMs: number): Promise<FiatTransferRecord[]>;
  /** Returns true on first delivery; false when (provider, eventId) was seen. */
  recordWebhookEvent(event: {
    provider: "zerohash" | "plaid";
    eventId: string;
    eventType?: string | undefined;
    transferId?: string | undefined;
    payload: unknown;
  }): Promise<boolean>;
}

function toRecord(row: typeof fiatTransfers.$inferSelect): FiatTransferRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as FiatTransferKind,
    amountUsd: row.amountUsd,
    status: row.status as FiatTransferStatus,
    provider: row.provider as "sandbox" | "zerohash",
    idempotencyKey: row.idempotencyKey,
    zhTransferId: row.zhTransferId,
    zhParticipantCode: row.zhParticipantCode,
    providerStatus: row.providerStatus,
    failureReason: row.failureReason,
    recoveryAction: row.recoveryAction,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function transitionSets(
  to: FiatTransferStatus,
  patch: FiatTransitionPatch | undefined,
): Record<string, unknown> {
  return {
    status: to,
    updatedAt: new Date(),
    ...(to === "complete" ? { completedAt: new Date() } : {}),
    ...(patch?.providerStatus !== undefined ? { providerStatus: patch.providerStatus } : {}),
    ...(patch?.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
    ...(patch?.recoveryAction !== undefined ? { recoveryAction: patch.recoveryAction } : {}),
    ...(patch?.zhTransferId !== undefined ? { zhTransferId: patch.zhTransferId } : {}),
  };
}

export const dbFiatStore: FiatStore = {
  async ensureUser(privyUserId) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.privyUserId, privyUserId))
      .limit(1);
    const found = existing.at(0);
    if (found) return found.id;
    const inserted = await db
      .insert(users)
      .values({ privyUserId })
      .onConflictDoNothing({ target: users.privyUserId })
      .returning({ id: users.id });
    const row = inserted.at(0);
    if (row) return row.id;
    // Conflict raced with another insert — re-read.
    const reread = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.privyUserId, privyUserId))
      .limit(1);
    const rerow = reread.at(0);
    if (!rerow) throw new Error("Failed to ensure user row for fiat rails.");
    return rerow.id;
  },

  async getBankLink(userId) {
    const rows = await db
      .select()
      .from(fiatBankLinks)
      .where(eq(fiatBankLinks.userId, userId))
      .limit(1);
    const row = rows.at(0);
    if (!row) return null;
    return {
      userId: row.userId,
      provider: row.provider as "sandbox" | "plaid",
      status: row.status as "active" | "revoked",
      plaidItemId: row.plaidItemId,
      zhParticipantCode: row.zhParticipantCode,
      zhExternalAccountId: row.zhExternalAccountId,
      institutionName: row.institutionName,
      accountMask: row.accountMask,
    };
  },

  async upsertBankLink(record) {
    const values = {
      userId: record.userId,
      provider: record.provider,
      status: record.status,
      plaidItemId: record.plaidItemId ?? null,
      zhParticipantCode: record.zhParticipantCode ?? null,
      zhExternalAccountId: record.zhExternalAccountId ?? null,
      institutionName: record.institutionName ?? null,
      accountMask: record.accountMask ?? null,
      updatedAt: new Date(),
    };
    await db
      .insert(fiatBankLinks)
      .values(values)
      .onConflictDoUpdate({ target: fiatBankLinks.userId, set: values });
  },

  async insertTransfer(transfer) {
    const rows = await db
      .insert(fiatTransfers)
      .values({
        userId: transfer.userId,
        kind: transfer.kind,
        amountUsd: transfer.amountUsd,
        provider: transfer.provider,
        idempotencyKey: transfer.idempotencyKey,
        zhTransferId: transfer.zhTransferId ?? null,
        zhParticipantCode: transfer.zhParticipantCode ?? null,
        providerStatus: transfer.providerStatus ?? null,
      })
      .returning();
    const row = rows.at(0);
    if (!row) throw new Error("fiat transfer insert returned no row");
    return toRecord(row);
  },

  async listTransfers(userId, limit = 50) {
    const rows = await db
      .select()
      .from(fiatTransfers)
      .where(eq(fiatTransfers.userId, userId))
      .orderBy(desc(fiatTransfers.createdAt))
      .limit(limit);
    return rows.map(toRecord);
  },

  async getTransferByZhId(zhTransferId) {
    const rows = await db
      .select()
      .from(fiatTransfers)
      .where(eq(fiatTransfers.zhTransferId, zhTransferId))
      .limit(1);
    const row = rows.at(0);
    return row ? toRecord(row) : null;
  },

  async transition(id, to, patch) {
    const priors = FIAT_TRANSFER_PRIOR_STATUSES[to];
    if (priors.length === 0) return null; // nothing may transition INTO pending
    const rows = await db
      .update(fiatTransfers)
      .set(transitionSets(to, patch))
      .where(and(eq(fiatTransfers.id, id), inArray(fiatTransfers.status, [...priors])))
      .returning();
    const row = rows.at(0);
    return row ? toRecord(row) : null;
  },

  async completeStaleSandboxPendings(userId, olderThanMs) {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await db
      .update(fiatTransfers)
      .set({
        status: "complete",
        providerStatus: "settled",
        recoveryAction: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fiatTransfers.userId, userId),
          eq(fiatTransfers.provider, "sandbox"),
          eq(fiatTransfers.status, "pending"),
          lt(fiatTransfers.createdAt, cutoff),
        ),
      )
      .returning();
    return rows.map(toRecord);
  },

  async recordWebhookEvent(event) {
    const rows = await db
      .insert(fiatWebhookEvents)
      .values({
        provider: event.provider,
        eventId: event.eventId,
        eventType: event.eventType ?? null,
        transferId: event.transferId ?? null,
        payload: event.payload ?? {},
      })
      .onConflictDoNothing({ target: [fiatWebhookEvents.provider, fiatWebhookEvents.eventId] })
      .returning({ id: fiatWebhookEvents.id });
    return rows.length > 0;
  },
};

/**
 * In-memory store for unit tests (CI has no Postgres). Enforces the same
 * one-way transitions through `canTransitionFiatTransfer` — the shared map.
 */
export function createMemoryFiatStore(): FiatStore {
  const usersByPrivy = new Map<string, string>();
  const links = new Map<string, FiatBankLinkRecord>();
  const transfers = new Map<string, FiatTransferRecord>();
  const webhookSeen = new Set<string>();

  return {
    ensureUser(privyUserId) {
      let id = usersByPrivy.get(privyUserId);
      if (!id) {
        id = randomUUID();
        usersByPrivy.set(privyUserId, id);
      }
      return Promise.resolve(id);
    },
    getBankLink(userId) {
      return Promise.resolve(links.get(userId) ?? null);
    },
    upsertBankLink(record) {
      links.set(record.userId, record);
      return Promise.resolve();
    },
    insertTransfer(transfer) {
      const now = new Date();
      const record: FiatTransferRecord = {
        id: randomUUID(),
        userId: transfer.userId,
        kind: transfer.kind,
        amountUsd: transfer.amountUsd,
        status: "pending",
        provider: transfer.provider,
        idempotencyKey: transfer.idempotencyKey,
        zhTransferId: transfer.zhTransferId ?? null,
        zhParticipantCode: transfer.zhParticipantCode ?? null,
        providerStatus: transfer.providerStatus ?? null,
        failureReason: null,
        recoveryAction: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      transfers.set(record.id, record);
      return Promise.resolve(record);
    },
    listTransfers(userId, limit = 50) {
      const rows = [...transfers.values()]
        .filter((t) => t.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
      return Promise.resolve(rows);
    },
    getTransferByZhId(zhTransferId) {
      const row = [...transfers.values()].find((t) => t.zhTransferId === zhTransferId) ?? null;
      return Promise.resolve(row);
    },
    transition(id, to, patch) {
      const row = transfers.get(id);
      if (!row || !canTransitionFiatTransfer(row.status, to)) return Promise.resolve(null);
      row.status = to;
      row.updatedAt = new Date();
      if (to === "complete") row.completedAt = new Date();
      if (patch?.providerStatus !== undefined) row.providerStatus = patch.providerStatus;
      if (patch?.failureReason !== undefined) row.failureReason = patch.failureReason;
      if (patch?.recoveryAction !== undefined) row.recoveryAction = patch.recoveryAction;
      if (patch?.zhTransferId !== undefined) row.zhTransferId = patch.zhTransferId;
      return Promise.resolve({ ...row });
    },
    completeStaleSandboxPendings(userId, olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      const updated: FiatTransferRecord[] = [];
      for (const row of transfers.values()) {
        if (
          row.userId === userId &&
          row.provider === "sandbox" &&
          row.status === "pending" &&
          row.createdAt.getTime() < cutoff
        ) {
          row.status = "complete";
          row.providerStatus = "settled";
          row.recoveryAction = null;
          row.completedAt = new Date();
          row.updatedAt = new Date();
          updated.push({ ...row });
        }
      }
      return Promise.resolve(updated);
    },
    recordWebhookEvent(event) {
      const key = `${event.provider}:${event.eventId}`;
      if (webhookSeen.has(key)) return Promise.resolve(false);
      webhookSeen.add(key);
      return Promise.resolve(true);
    },
  };
}
