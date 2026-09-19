import { ChatStreamError, streamChatEvents } from "@/lib/chat-stream.ts";
import { type AgentChatEvent } from "@/features/agent/agent-stream.ts";

/**
 * Client for the read-only research analyst SSE endpoint
 * (`POST /api/analyze/chat`). Same wire format as the wallet agent
 * (`agent-stream.ts`) — each `data:` frame is one `AgentChatEvent` — and,
 * since task 070, the same transport (`lib/chat-stream.ts`). Chat requires
 * login (owner decision 2026-08-18), so the Privy token rides along; prior
 * turns replay as `history`.
 */

export interface AnalyzeHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

/** Kept as the name callers check with `instanceof`. */
export { ChatStreamError as AnalyzeStreamError };

export async function streamAnalyzeChat(
  params: { message: string; history?: AnalyzeHistoryTurn[] },
  onEvent: (event: AgentChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamChatEvents(
    "/api/analyze/chat",
    {
      message: params.message,
      ...(params.history && params.history.length > 0 ? { history: params.history } : {}),
    },
    onEvent,
    signal,
  );
}
