import { createHash, randomUUID } from "node:crypto";
import type { SharedCacheClient } from "../shared-cache.ts";
import type { ComboQuoteOk } from "../combos/combo-quote-types.ts";
import type { TradeSimulation } from "./trade-simulation.ts";

/**
 * Phase 8 / A-026, A-031 — previews and confirmations.
 *
 * A PREVIEW is what the agent shows the user before asking: for a market
 * trade it is the full `TradeSimulation`; for any other money-moving tool
 * (swap, send, liquidity, bridge, gateway, jobs, paid services) it is the
 * tool name plus a canonical hash of its arguments and a short human
 * summary. One pending preview per chat session — a new one replaces it.
 *
 * A CONFIRMATION is minted by the server when the user's OWN next message
 * explicitly confirms (`messageConfirmsAction`) while a preview is pending.
 * It carries a unique id, is bound to that preview, expires, and is
 * single-use: `take()` removes it. The model must present the id at
 * execution, and the execution must match the preview's tool and
 * arguments — so the only way money moves is preview → user's words →
 * server-minted id → matching call. The model cannot mint one.
 *
 * Stored in the shared Redis when configured (a confirmation minted on one
 * lambda must be honored on another); in-memory otherwise (dev, tests).
 */

/** `combo` (task 072): a quoted combo ticket, re-quoted and drift-checked at execution. */
export type PreviewKind = "market_trade" | "action" | "combo";

export interface Preview {
  previewId: string;
  sessionId: string;
  kind: PreviewKind;
  /** The tool the execution must call. */
  tool: string;
  /** Canonical hash of the execution arguments (for `action` previews). */
  argsHash: string;
  /** For market trades, the confirmed simulation. */
  simulation: TradeSimulation | null;
  /** For combos, the confirmed quote (task 072). */
  combo?: ComboQuoteOk | null;
  summary: string;
  createdAt: number;
  expiresAt: number;
}

export interface Confirmation {
  confirmationId: string;
  previewId: string;
  sessionId: string;
  preview: Preview;
  /** SHA-256 of the confirming message — recorded for the audit trail. */
  messageHash: string;
  issuedAt: number;
  expiresAt: number;
}

export const PREVIEW_TTL_MS = 10 * 60_000;
export const CONFIRMATION_TTL_MS = 5 * 60_000;

/** Stable hash of a tool call's arguments: sorted keys, no whitespace. */
export function argsHash(tool: string, args: Record<string, unknown>): string {
  const canonical = JSON.stringify(sortKeys(stripConfirmation(args)));
  return createHash("sha256").update(`${tool}\n${canonical}`).digest("hex");
}

function stripConfirmation(args: Record<string, unknown>): Record<string, unknown> {
  const { confirmationId: _c, ...rest } = args;
  return rest;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    for (const k of Object.keys(record).sort()) {
      out[k] = sortKeys(record[k]);
    }
    return out;
  }
  return value;
}

export function hashMessage(message: string): string {
  return createHash("sha256").update(message).digest("hex");
}

interface Kv {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
}

function memoryKv(now: () => number): Kv {
  const m = new Map<string, { value: string; expiresAt: number }>();
  return {
    get: (key) => {
      const hit = m.get(key);
      if (!hit || hit.expiresAt <= now()) {
        m.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(hit.value);
    },
    set: (key, value, ttlMs) => {
      m.set(key, { value, expiresAt: now() + ttlMs });
      return Promise.resolve();
    },
    del: (key) => {
      m.delete(key);
      return Promise.resolve();
    },
  };
}

function redisKv(client: SharedCacheClient): Kv {
  return {
    get: (key) => client.get(key),
    set: async (key, value, ttlMs) => {
      await client.set(key, value, { ex: Math.max(1, Math.ceil(ttlMs / 1000)) });
    },
    del: async (key) => {
      await client.del(key);
    },
  };
}

function parse(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export class ConfirmationStore {
  private readonly kv: Kv;
  private readonly now: () => number;
  private readonly prefix: string;

  constructor(opts: { client: SharedCacheClient | null; now?: () => number; prefix?: string }) {
    this.now = opts.now ?? (() => Date.now());
    this.kv = opts.client ? redisKv(opts.client) : memoryKv(this.now);
    this.prefix = opts.prefix ?? "mantua:agent:";
  }

  /** Save (and replace) the session's pending preview. */
  async savePreview(
    input: Omit<Preview, "previewId" | "createdAt" | "expiresAt">,
  ): Promise<Preview> {
    const now = this.now();
    const preview: Preview = {
      ...input,
      previewId: randomUUID(),
      createdAt: now,
      expiresAt: now + PREVIEW_TTL_MS,
    };
    await this.kv.set(
      `${this.prefix}preview:${input.sessionId}`,
      JSON.stringify(preview),
      PREVIEW_TTL_MS,
    );
    return preview;
  }

  async pendingPreview(sessionId: string): Promise<Preview | null> {
    const p = parse(await this.kv.get(`${this.prefix}preview:${sessionId}`)) as Preview | null;
    if (!p || p.expiresAt <= this.now()) return null;
    return p;
  }

  async clearPreview(sessionId: string): Promise<void> {
    await this.kv.del(`${this.prefix}preview:${sessionId}`);
  }

  /** Mint a single-use confirmation for the session's pending preview. */
  async mint(sessionId: string, preview: Preview, message: string): Promise<Confirmation> {
    const now = this.now();
    const confirmation: Confirmation = {
      confirmationId: randomUUID(),
      previewId: preview.previewId,
      sessionId,
      preview,
      messageHash: hashMessage(message),
      issuedAt: now,
      expiresAt: now + CONFIRMATION_TTL_MS,
    };
    await this.kv.set(
      `${this.prefix}confirmation:${confirmation.confirmationId}`,
      JSON.stringify(confirmation),
      CONFIRMATION_TTL_MS,
    );
    // The preview is spent by the confirmation; a second "confirm" must not
    // mint a second id for the same preview.
    await this.clearPreview(sessionId);
    return confirmation;
  }

  /** Read without consuming (the turn context holds it until execution). */
  async peek(confirmationId: string): Promise<Confirmation | null> {
    const c = parse(
      await this.kv.get(`${this.prefix}confirmation:${confirmationId}`),
    ) as Confirmation | null;
    if (!c || c.expiresAt <= this.now()) return null;
    return c;
  }

  /** Consume: after this the id is gone, whatever the execution's outcome. */
  async take(confirmationId: string): Promise<Confirmation | null> {
    const c = await this.peek(confirmationId);
    if (c) await this.kv.del(`${this.prefix}confirmation:${confirmationId}`);
    return c;
  }
}
