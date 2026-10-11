/**
 * Frame helpers for the demo's scripted streams: the same `AgentChatEvent`
 * wire format the analyst (`/api/analyze/chat`) and the agent
 * (`/api/agent/chat`) emit, with authored pauses so the words arrive the
 * way a model's do. The turns themselves live in `turns-analyze.ts`
 * (generated from today's slate) and `turns-agent.ts`.
 */
export interface Frame {
  /** Milliseconds to wait before this frame is sent. */
  wait: number;
  event: Record<string, unknown>;
}

export interface Turn {
  prompt: string;
  frames: Frame[];
}

export const text = (delta: string, wait = 60): Frame => ({ wait, event: { type: "text", delta } });
export const start = (id: string, tool: string, wait = 400): Frame => ({
  wait,
  event: { type: "tool_start", id, tool, args: {} },
});
export const result = (id: string, tool: string, data: unknown, wait = 900): Frame => ({
  wait,
  event: { type: "tool_result", id, tool, ok: true, data },
});
/** Stream a sentence word by word, like a model does. */
export function words(s: string, perWord = 45): Frame[] {
  return s.split(/(?<=\s)/).map((w, i) => text(w, i === 0 ? 250 : perWord));
}
export const done: Frame = { wait: 300, event: { type: "done" } };
export const session: Frame = { wait: 0, event: { type: "session", sessionId: "demo" } };

/** How long a turn's stream takes to play, in milliseconds. */
export function playTime(turn: Turn): number {
  return turn.frames.reduce((n, f) => n + f.wait, 0);
}
