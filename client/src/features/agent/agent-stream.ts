import { getAccessToken } from "@privy-io/react-auth";
import { API_BASE } from "@/lib/api.ts";

/**
 * Client for the conversational agent's SSE endpoint (`POST /api/agent/chat`).
 *
 * EventSource only does GET, so we POST with fetch and parse the
 * `text/event-stream` body ourselves. Each `data:` frame is one
 * `AgentChatEvent` (mirrors the server union in `server/src/lib/agent-chat.ts`).
 */

export type AgentChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; tool: string; ok: boolean; data?: unknown; error?: string }
  | { type: "done" }
  | { type: "error"; message: string };

export class AgentStreamError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AgentStreamError";
    this.status = status;
  }
}

interface ApiErrorBody {
  error?: string;
}

/**
 * Stream one turn. Calls `onEvent` for each event as it arrives. Resolves when
 * the stream ends; rejects (before any event) on a non-OK HTTP response so the
 * caller can show auth/unavailable errors.
 */
export async function streamAgentChat(
  params: { message: string; sessionId?: string | undefined; chainId?: number | undefined },
  onEvent: (event: AgentChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = await getAccessToken();
  const headers = new Headers({ "Content-Type": "application/json", Accept: "text/event-stream" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}/api/agent/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: params.message,
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.chainId ? { chainId: params.chainId } : {}),
    }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new AgentStreamError(res.status, body.error ?? `Request failed (${String(res.status)})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice("data:".length).trim();
      if (!json) continue;
      try {
        onEvent(JSON.parse(json) as AgentChatEvent);
      } catch {
        // Ignore a malformed frame rather than killing the stream.
      }
    }
  }
}
