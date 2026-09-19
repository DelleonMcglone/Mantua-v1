import { getAccessToken } from "@privy-io/react-auth";
import { API_BASE } from "@/lib/api.ts";
import { readSseBody, sseJson } from "@/lib/sse-core.ts";

/**
 * Task 070 — the one SSE POST client every chat surface uses (the wallet
 * agent, the research analyst, support). EventSource only does GET, so we
 * POST with fetch and parse the `text/event-stream` body ourselves; each
 * `data:` frame is one event of the caller's type. A non-OK response
 * rejects with `ChatStreamError` before any event so the caller can show
 * auth / unavailable states; a malformed frame is skipped, never fatal.
 */

/** One frame of any chat stream (mirrors the server union in `server/src/lib/agent-chat.ts`). */
export type AgentChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; tool: string; ok: boolean; data?: unknown; error?: string }
  | { type: "done" }
  | { type: "error"; message: string };

export class ChatStreamError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ChatStreamError";
    this.status = status;
  }
}

interface ApiErrorBody {
  error?: string;
}

export async function streamChatEvents(
  path: string,
  body: Record<string, unknown>,
  onEvent: (event: AgentChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = await getAccessToken();
  const headers = new Headers({ "Content-Type": "application/json", Accept: "text/event-stream" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok || !res.body) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new ChatStreamError(res.status, parsed.error ?? `Request failed (${String(res.status)})`);
  }

  await readSseBody(res.body, (ev) => {
    const parsed = sseJson(ev);
    if (parsed !== null) onEvent(parsed as AgentChatEvent);
  });
}
