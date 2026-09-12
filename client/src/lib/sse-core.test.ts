import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSseParser, sseJson } from "./sse-core.ts";

/**
 * Phase 7 / R-001 — the one SSE parser every stream client shares. Pinned:
 * frames split on blank lines across chunk boundaries, comments
 * (heartbeats) yield nothing, `id`/`event`/`retry` ride through, multiple
 * `data:` lines join, CRLF is tolerated, and a trailing frame flushes on
 * `end()`.
 */
void describe("createSseParser", () => {
  void it("yields a complete event only once its blank-line terminator arrives, across chunks", () => {
    const p = createSseParser();
    assert.deepEqual(p.push("id: 1\nevent: sna"), []);
    assert.deepEqual(p.push('pshot\ndata: {"a":1}\n'), []);
    const events = p.push("\n");
    assert.deepEqual(events, [{ id: "1", event: "snapshot", data: '{"a":1}' }]);
  });

  void it("treats comment lines as heartbeats — no event, and they never corrupt the next frame", () => {
    const p = createSseParser();
    assert.deepEqual(p.push(": heartbeat\n\n"), []);
    assert.deepEqual(p.push(": heartbeat\n\nid: 2\ndata: x\n\n"), [{ id: "2", data: "x" }]);
  });

  void it("carries retry, joins multi-line data, strips one leading space, tolerates CRLF", () => {
    const p = createSseParser();
    const events = p.push("retry: 3000\r\n\r\ndata: line1\r\ndata:line2\r\nevent: slate\r\n\r\n");
    assert.deepEqual(events, [
      { data: "", retry: 3000 },
      { event: "slate", data: "line1\nline2" },
    ]);
  });

  void it("ignores unknown fields and a malformed retry", () => {
    const p = createSseParser();
    const events = p.push("foo: bar\nretry: soon\ndata: ok\n\n");
    assert.deepEqual(events, [{ data: "ok" }]);
  });

  void it("flushes a trailing unterminated frame on end(), and end() on nothing is empty", () => {
    const p = createSseParser();
    assert.deepEqual(p.push("data: tail"), []);
    assert.deepEqual(p.end(), [{ data: "tail" }]);
    assert.deepEqual(p.end(), []);
  });

  void it("handles many events in one chunk in order", () => {
    const p = createSseParser();
    const events = p.push("id: 1\ndata: a\n\nid: 2\ndata: b\n\nid: 3\ndata: c\n\n");
    assert.deepEqual(
      events.map((e) => e.id),
      ["1", "2", "3"],
    );
  });
});

void describe("sseJson", () => {
  void it("decodes JSON data and returns null for malformed or empty data instead of throwing", () => {
    assert.deepEqual(sseJson({ data: '{"a":1}' }), { a: 1 });
    assert.equal(sseJson({ data: "{not json" }), null);
    assert.equal(sseJson({ data: "" }), null);
  });
});
