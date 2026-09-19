import { ChatStreamError, streamChatEvents, type AgentChatEvent } from "@/lib/chat-stream.ts";

/**
 * Client for the conversational agent's SSE endpoint (`POST /api/agent/chat`).
 *
 * Each `data:` frame is one `AgentChatEvent` (mirrors the server union in
 * `server/src/lib/agent-chat.ts`). The transport — POST, auth header, SSE
 * parsing — and the event union live in `lib/chat-stream.ts`, shared with
 * the analyst and support since task 070; both names are re-exported here
 * for the callers that import them from this module.
 */

export type { AgentChatEvent };

/** Kept as the name callers check with `instanceof`. */
export { ChatStreamError as AgentStreamError };

/**
 * Stream one turn. Calls `onEvent` for each event as it arrives. Resolves when
 * the stream ends; rejects (before any event) on a non-OK HTTP response so the
 * caller can show auth/unavailable errors.
 */
export async function streamAgentChat(
  params: {
    message: string;
    sessionId?: string | undefined;
    chainId?: number | undefined;
    /**
     * Task 069 (V-009) — how the user entered this message. `"voice"`
     * makes the server refuse to mint a confirmation for the turn, so a
     * spoken word can never be the last step before money moves.
     */
    source?: "text" | "voice" | undefined;
  },
  onEvent: (event: AgentChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamChatEvents(
    "/api/agent/chat",
    {
      message: params.message,
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.chainId ? { chainId: params.chainId } : {}),
      ...(params.source ? { source: params.source } : {}),
    },
    onEvent,
    signal,
  );
}
