import { z } from "zod";
import type { DB } from "../../db/client.ts";
import { supportTickets, type NewSupportTicket } from "../../db/schema/social.ts";
import { logger } from "../logger.ts";

/**
 * Task 070 / AE-010 — escalation to a human. The support agent opens a
 * ticket with a summary and the tail of the conversation; a human moves
 * its status. The ticket row is the record; the webhook (when configured)
 * is the page. Neither the summary nor the transcript may be unbounded —
 * they come from a model and a user.
 */

export const TICKET_CATEGORIES = ["billing", "trading", "agent", "account", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const MAX_SUMMARY_CHARS = 2_000;
export const MAX_TRANSCRIPT_TURNS = 12;
export const MAX_TURN_CHARS = 2_000;

export const transcriptTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(8_000),
});
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

export interface TicketInput {
  userId: string | null;
  category: TicketCategory;
  summary: string;
  transcript: readonly TranscriptTurn[];
  channel: string;
}

/** Pure: the bounded row to insert. */
export function buildTicket(input: TicketInput): NewSupportTicket {
  return {
    userId: input.userId,
    category: input.category,
    summary: input.summary.trim().slice(0, MAX_SUMMARY_CHARS),
    transcript: input.transcript
      .slice(-MAX_TRANSCRIPT_TURNS)
      .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_TURN_CHARS) })),
    channel: input.channel.slice(0, 16),
  };
}

export interface EscalationPayload {
  ticketId: string;
  category: TicketCategory;
  summary: string;
  channel: string;
  anonymous: boolean;
  createdAt: string;
}

/** What the webhook receives: the ticket, never the transcript or the user id. */
export function escalationPayload(
  ticketId: string,
  row: NewSupportTicket,
  createdAt: Date,
): EscalationPayload {
  return {
    ticketId,
    category: row.category as TicketCategory,
    summary: row.summary,
    channel: row.channel ?? "web",
    anonymous: row.userId === null || row.userId === undefined,
    createdAt: createdAt.toISOString(),
  };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Best-effort POST of the payload; a failure is logged, never thrown. */
export async function notifyWebhook(
  url: string | undefined,
  payload: EscalationPayload,
  fetchImpl: FetchLike,
): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) logger.warn({ status: res.status }, "support escalation webhook rejected");
    return res.ok;
  } catch (err) {
    logger.warn({ err }, "support escalation webhook failed");
    return false;
  }
}

export interface EscalationDeps {
  webhookUrl?: string | undefined;
  fetch: FetchLike;
  now?: () => Date;
}

/** Insert the ticket and notify; returns the id the user is told. */
export async function openTicket(
  db: DB,
  input: TicketInput,
  deps: EscalationDeps,
): Promise<{ id: string; notified: boolean }> {
  const row = buildTicket(input);
  const [inserted] = await db
    .insert(supportTickets)
    .values(row)
    .returning({ id: supportTickets.id });
  const payload = escalationPayload(inserted.id, row, deps.now?.() ?? new Date());
  logger.info({ escalation: payload }, "support escalation");
  const notified = await notifyWebhook(deps.webhookUrl, payload, deps.fetch);
  return { id: inserted.id, notified };
}
