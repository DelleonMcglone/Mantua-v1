/**
 * Task 071 (MX-004) — the five notification topics a user opts in or out
 * of, and how a subscription's stored opt-in is read (absent = on).
 */
export const PUSH_TOPICS = ["trades", "positions", "games", "agent", "settlement"] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];

export function isPushTopic(v: unknown): v is PushTopic {
  return typeof v === "string" && (PUSH_TOPICS as readonly string[]).includes(v);
}

/** A subscription's per-topic opt-in; a topic never set is on. */
export function topicEnabled(topics: unknown, topic: PushTopic): boolean {
  if (typeof topics !== "object" || topics === null) return true;
  const v = (topics as Record<string, unknown>)[topic];
  return v !== false;
}
