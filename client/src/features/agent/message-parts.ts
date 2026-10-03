/**
 * The order things happened in an assistant turn: text, then a tool, then
 * more text. The message keeps `text` (everything said) and `steps` (every
 * tool) for the code that reads them whole; `parts` is the interleaving the
 * bubble renders, so findings sit between the source pills that produced
 * them — the Coinbase for Agents reading order (owner, 2026-10-03).
 */
export type MessagePart = { kind: "text"; text: string } | { kind: "step"; id: string };

export function appendText(parts: readonly MessagePart[], delta: string): MessagePart[] {
  const last = parts.at(-1);
  if (last?.kind === "text") {
    return [...parts.slice(0, -1), { kind: "text", text: last.text + delta }];
  }
  return [...parts, { kind: "text", text: delta }];
}

export function appendStep(parts: readonly MessagePart[], id: string): MessagePart[] {
  return [...parts, { kind: "step", id }];
}
