/**
 * Task 069 (V-009) — carrying "this was spoken" from the microphone to the
 * chat request.
 *
 * Provenance has to survive the hop from the command bar to the agent
 * panel, which happens through a DOM event. This module owns that event's
 * payload so both ends agree on it, and tolerates the older plain-string
 * detail so a stale listener never crashes.
 *
 * The flag is a safety interlock for the honest path, not an authorization
 * boundary: the boundary is the server's confirmation store, which refuses
 * to mint from a spoken turn. What this buys is that a user who speaks
 * "confirm" is told it did not count, instead of watching the word land in
 * the chat and assuming it did.
 */

export const AGENT_INPUT_EVENT = "mantua:agent-input";

export interface SpokenCommand {
  text: string;
  /** True when the text was transcribed from speech rather than typed. */
  spoken: boolean;
}

/** How the agent request names the two ways a message can arrive. */
export type CommandSource = "text" | "voice";

export function sourceOf(spoken: boolean): CommandSource {
  return spoken ? "voice" : "text";
}

/**
 * Reads the event payload.
 *
 * @param detail the `CustomEvent.detail`, which older code sent as a bare
 *   string. An unreadable payload yields empty text, which callers drop.
 */
export function readAgentInput(detail: unknown): SpokenCommand {
  if (typeof detail === "string") return { text: detail, spoken: false };
  if (typeof detail !== "object" || detail === null) return { text: "", spoken: false };
  const { text, spoken } = detail as { text?: unknown; spoken?: unknown };
  return {
    text: typeof text === "string" ? text : "",
    spoken: spoken === true,
  };
}

export function agentInputEvent(command: SpokenCommand): CustomEvent<SpokenCommand> {
  return new CustomEvent<SpokenCommand>(AGENT_INPUT_EVENT, { detail: command });
}
