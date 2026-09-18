import { getAccessToken } from "@privy-io/react-auth";
import { API_BASE } from "@/lib/api.ts";
import { readSseBody, sseJson } from "@/lib/sse-core.ts";

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

  // Phase 7 — one SSE parser for every stream (lib/sse-core.ts); a
  // malformed frame yields null and is skipped rather than killing the stream.
  await readSseBody(res.body, (ev) => {
    const parsed = sseJson(ev);
    if (parsed !== null) onEvent(parsed as AgentChatEvent);
  });
}
