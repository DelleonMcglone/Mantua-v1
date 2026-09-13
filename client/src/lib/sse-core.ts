/**
 * Phase 7 / R-001 — a pure, incremental `text/event-stream` parser.
 *
 * One parser serves every stream client (the live market stream, the
 * agent chat, the analyst): feed it decoded chunks as they arrive and it
 * yields complete events, holding a partial frame across chunk
 * boundaries. Follows the SSE spec's framing: frames end at a blank line,
 * lines are `field: value`, `:`-prefixed lines are comments (heartbeats),
 * multiple `data:` lines join with `\n`, and `id:` / `event:` / `retry:`
 * are carried through. Pure — no fetch, no React — so it is unit-tested
 * with the repo's node:test runner.
 */

export interface SseEvent {
  /** `event:` field; absent means the default `message` type. */
  event?: string;
  /** `id:` field, kept as the string the server sent. */
  id?: string;
  /** Joined `data:` payload (raw text, not parsed). */
  data: string;
  /** `retry:` field in ms when the server sent one. */
  retry?: number;
}

export interface SseParser {
  /** Feed one decoded chunk; returns every event completed by it. */
  push(chunk: string): SseEvent[];
  /** Flush a trailing frame that ended without a blank line (stream end). */
  end(): SseEvent[];
}

function parseFrame(frame: string): SseEvent | null {
  const dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  let sawField = false;
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0 || line.startsWith(":")) continue; // comment / heartbeat
    sawField = true;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        dataLines.push(value);
        break;
      case "event":
        event = value;
        break;
      case "id":
        id = value;
        break;
      case "retry": {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 0) retry = n;
        break;
      }
      default:
        break; // unknown fields are ignored per spec
    }
  }
  if (!sawField) return null;
  return {
    data: dataLines.join("\n"),
    ...(event !== undefined ? { event } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(retry !== undefined ? { retry } : {}),
  };
}

export function createSseParser(): SseParser {
  let buffer = "";
  const drain = (final: boolean): SseEvent[] => {
    const out: SseEvent[] = [];
    // Normalize CRLF frame separators to LF so one split handles both.
    buffer = buffer.replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = final ? "" : (frames.pop() ?? "");
    for (const frame of frames) {
      const ev = parseFrame(frame);
      if (ev) out.push(ev);
    }
    return out;
  };
  return {
    push(chunk) {
      buffer += chunk;
      return drain(false);
    },
    end() {
      if (buffer.trim().length === 0) {
        buffer = "";
        return [];
      }
      return drain(true);
    },
  };
}

/**
 * Read a fetch `Response` body as SSE, calling `onEvent` per event. Resolves
 * when the body ends; rejects on a read error. The caller owns the abort
 * signal on the fetch.
 */
export async function readSseBody(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
  onActivity?: () => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // Any bytes — a heartbeat comment included — prove the stream is alive.
    onActivity?.();
    for (const ev of parser.push(decoder.decode(value, { stream: true }))) onEvent(ev);
  }
  for (const ev of parser.end()) onEvent(ev);
}

/** JSON-decode an event's data, or null on malformed data (never throw:
 *  one bad frame must not kill a stream). */
export function sseJson(event: SseEvent): unknown {
  if (!event.data) return null;
  try {
    return JSON.parse(event.data) as unknown;
  } catch {
    return null;
  }
}
