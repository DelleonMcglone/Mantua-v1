import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STREAM_BACKOFF_BASE_MS,
  STREAM_BACKOFF_MAX_MS,
  STREAM_FALLBACK_AFTER_FAILURES,
  reconnectDelayMs,
  shouldFallbackToPolling,
} from "./stream-policy-core.ts";

void describe("reconnectDelayMs (R-001 reconnect policy)", () => {
  void it("honors the server's retry hint on the first attempt so a deliberate end reconnects promptly", () => {
    assert.equal(
      reconnectDelayMs(1, 3_000, () => 0.99),
      3_000,
    );
  });

  void it("backs off exponentially with full jitter, capped at the ceiling", () => {
    assert.equal(
      reconnectDelayMs(1, null, () => 1),
      STREAM_BACKOFF_BASE_MS,
    );
    assert.equal(
      reconnectDelayMs(2, null, () => 1),
      STREAM_BACKOFF_BASE_MS * 2,
    );
    assert.equal(
      reconnectDelayMs(3, null, () => 0.5),
      STREAM_BACKOFF_BASE_MS * 2,
    );
    assert.equal(
      reconnectDelayMs(20, null, () => 1),
      STREAM_BACKOFF_MAX_MS,
    );
    assert.equal(
      reconnectDelayMs(20, null, () => 0),
      0,
      "full jitter can land at zero",
    );
  });

  void it("ignores the server hint after the first attempt (repeated failures must spread out)", () => {
    assert.equal(
      reconnectDelayMs(2, 3_000, () => 1),
      STREAM_BACKOFF_BASE_MS * 2,
    );
  });
});

void describe("shouldFallbackToPolling", () => {
  void it("falls back immediately when the server sheds the connection (503)", () => {
    assert.equal(shouldFallbackToPolling(1, { kind: "http", status: 503 }), true);
  });

  void it("otherwise falls back only after the failure threshold", () => {
    assert.equal(
      shouldFallbackToPolling(STREAM_FALLBACK_AFTER_FAILURES - 1, { kind: "network" }),
      false,
    );
    assert.equal(
      shouldFallbackToPolling(STREAM_FALLBACK_AFTER_FAILURES, { kind: "network" }),
      true,
    );
    assert.equal(
      shouldFallbackToPolling(STREAM_FALLBACK_AFTER_FAILURES, { kind: "silence" }),
      true,
    );
    assert.equal(shouldFallbackToPolling(1, { kind: "http", status: 500 }), false);
    assert.equal(shouldFallbackToPolling(0, null), false);
  });
});
