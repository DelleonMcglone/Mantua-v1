import type { Intent } from "./chat-intent.ts";

/**
 * A dock submission made while the analyst thread is already open and that
 * is itself a research question (or free text) continues that thread: it is
 * appended to the open conversation, never turned into a new route.
 *
 * This used to be decided only for signed-in users. A logged-out visitor's
 * second question re-routed instead; the open panel had already seeded
 * itself once, so nothing happened — the symptom was "submit does nothing,
 * output stays on the last answer".
 */
export function continuesAnalystThread(
  routeKind: string,
  intent: Pick<Intent, "kind"> | null,
): boolean {
  return routeKind === "analyze" && (intent === null || intent.kind === "analyze");
}
