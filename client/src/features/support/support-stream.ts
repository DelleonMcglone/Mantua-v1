import { streamChatEvents } from "@/lib/chat-stream.ts";
import { type AgentChatEvent } from "@/features/agent/agent-stream.ts";

/**
 * Task 070 / AE-007 — client for the support agent's SSE endpoint
 * (`POST /api/support/chat`). Same event union as the other chats; works
 * signed out (general help) and signed in (the caller's own account).
 */

export interface SupportHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export async function streamSupportChat(
  params: { message: string; history?: SupportHistoryTurn[] },
  onEvent: (event: AgentChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamChatEvents(
    "/api/support/chat",
    {
      message: params.message,
      channel: "web",
      ...(params.history && params.history.length > 0 ? { history: params.history } : {}),
    },
    onEvent,
    signal,
  );
}
