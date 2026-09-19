import { db } from "../../db/client.ts";
import { env } from "../../env.ts";
import { platformStatusReader } from "../../routes/platform-status.ts";
import { readAccountContext, type AccountContext } from "./account-context.ts";
import {
  openTicket,
  TICKET_CATEGORIES,
  type TicketCategory,
  type TranscriptTurn,
} from "./escalation.ts";
import { searchKnowledge } from "./knowledge.ts";
import {
  detectIssue,
  troubleshoot,
  TROUBLESHOOT_ISSUES,
  type TroubleshootContext,
  type TroubleshootIssue,
} from "./troubleshoot.ts";

/**
 * Task 070 / AE-007 … AE-010 — the support agent's tool executor and its
 * production dependencies. Every tool reads; only `escalate_to_human`
 * writes, and it writes a ticket. The account context is read at most
 * once per turn and only for the signed-in caller.
 */

export interface SupportAuth {
  privyUserId: string;
  walletAddress: string | undefined;
}

export interface SupportTurnParams {
  message: string;
  history?: TranscriptTurn[];
  channel: string;
  auth: SupportAuth | null;
}

export interface SupportIo {
  readAccount: (auth: SupportAuth) => Promise<AccountContext | null>;
  readStatus: () => Promise<TroubleshootContext["platform"]>;
  escalate: (input: {
    userId: string | null;
    category: TicketCategory;
    summary: string;
    transcript: TranscriptTurn[];
    channel: string;
  }) => Promise<{ id: string; notified: boolean }>;
}

export const productionSupportIo: SupportIo = {
  readAccount: (auth) => readAccountContext(db, auth.privyUserId, auth.walletAddress),
  readStatus: async () => {
    const s = await platformStatusReader();
    return { mode: s.mode, trading: s.trading, reads: s.reads, message: s.message };
  },
  escalate: (input) =>
    openTicket(db, input, {
      webhookUrl: env.SUPPORT_ESCALATION_WEBHOOK_URL,
      fetch: (url, init) => fetch(url, init),
    }),
};

function isIssue(v: unknown): v is TroubleshootIssue {
  return typeof v === "string" && (TROUBLESHOOT_ISSUES as readonly string[]).includes(v);
}
function isCategory(v: unknown): v is TicketCategory {
  return typeof v === "string" && (TICKET_CATEGORIES as readonly string[]).includes(v);
}

/** A per-turn, memoised read of the caller's own account (null when anonymous). */
export function accountReader(
  params: SupportTurnParams,
  io: SupportIo,
): () => Promise<AccountContext | null> {
  let cached: Promise<AccountContext | null> | null = null;
  return () => {
    if (!params.auth) return Promise.resolve(null);
    cached ??= io.readAccount(params.auth);
    return cached;
  };
}

/** Execute one tool call; a thrown error is fed back to the model as a tool error. */
export async function executeSupportTool(
  name: string,
  input: Record<string, unknown>,
  params: SupportTurnParams,
  io: SupportIo,
  account: () => Promise<AccountContext | null>,
): Promise<unknown> {
  switch (name) {
    case "search_help":
      return { topics: searchKnowledge(typeof input["query"] === "string" ? input["query"] : "") };
    case "get_platform_status":
      return await io.readStatus();
    case "get_account_context": {
      if (!params.auth)
        return { signedIn: false, note: "The user is not signed in; only general help applies." };
      const ctx = await account();
      return ctx ? { signedIn: true, ...ctx } : { signedIn: true, note: "No account record yet." };
    }
    case "troubleshoot": {
      const issue = isIssue(input["issue"]) ? input["issue"] : detectIssue(params.message);
      if (!issue) throw new Error(`issue must be one of ${TROUBLESHOOT_ISSUES.join(", ")}`);
      const ctx = params.auth ? await account() : null;
      return troubleshoot(issue, {
        platform: await io.readStatus(),
        account: ctx?.troubleshoot ?? null,
      });
    }
    case "escalate_to_human": {
      if (!isCategory(input["category"]))
        throw new Error(`category must be one of ${TICKET_CATEGORIES.join(", ")}`);
      const summary = typeof input["summary"] === "string" ? input["summary"] : "";
      if (summary.length < 10) throw new Error("summary must describe the problem");
      const ticket = await io.escalate({
        userId: (await account())?.userId ?? null,
        category: input["category"],
        summary,
        transcript: [...(params.history ?? []), { role: "user", text: params.message }],
        channel: params.channel,
      });
      return { ticketId: ticket.id, notified: ticket.notified };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
