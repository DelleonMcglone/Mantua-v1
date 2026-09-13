import { getAccessToken } from "@privy-io/react-auth";
import { API_BASE } from "@/lib/api.ts";
import { readSseBody, sseJson } from "@/lib/sse-core.ts";
import { type AgentChatEvent } from "@/features/agent/agent-stream.ts";

/**
 * Client for the read-only research analyst SSE endpoint
 * (`POST /api/analyze/chat`). Same wire format as the wallet agent
 * (`agent-stream.ts`) — each `data:` frame is one `AgentChatEvent` — but the
 * endpoint is public, so no auth header, and we replay prior turns as `history`.
 */

export interface AnalyzeHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export class AnalyzeStreamError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AnalyzeStreamError";
    this.status = status;
  }
}

interface ApiErrorBody {
  error?: string;
}

export async function streamAnalyzeChat(
  params: { message: string; history?: AnalyzeHistoryTurn[] },
  onEvent: (event: AgentChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Chat requires login (owner decision 2026-08-18) — attach the Privy token.
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/api/analyze/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message: params.message,
      ...(params.history && params.history.length > 0 ? { history: params.history } : {}),
    }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new AnalyzeStreamError(
      res.status,
      body.error ?? `Request failed (${String(res.status)})`,
    );
  }

  // Phase 7 — one SSE parser for every stream (lib/sse-core.ts); a
  // malformed frame yields null and is skipped rather than killing the stream.
  await readSseBody(res.body, (ev) => {
    const parsed = sseJson(ev);
    if (parsed !== null) onEvent(parsed as AgentChatEvent);
  });
}
