import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UNREACHABLE_AFTER_MS,
  buysBlockedByStatus,
  deriveBanner,
  type PlatformStatusWire,
} from "./connection-status-core.ts";

const NOW = 1_800_000_000_000;

function status(over: Partial<PlatformStatusWire>): PlatformStatusWire {
  return {
    generatedAt: NOW,
    mode: "live",
    reads: "live",
    trading: "open",
    killSwitch: false,
    message: null,
    ...over,
  };
}

/**
 * Phase 7 / R-005 — the banner never goes silent: offline beats
 * unreachable beats the server's own degradation, and a live platform
 * shows nothing.
 */
void describe("deriveBanner", () => {
  void it("live platform, recently heard → no banner", () => {
    assert.equal(
      deriveBanner({ status: status({}), lastHeardAt: NOW - 5_000, online: true, now: NOW }),
      null,
    );
  });

  void it("offline wins over everything, with an error tone", () => {
    const b = deriveBanner({
      status: status({ mode: "paused" }),
      lastHeardAt: NOW,
      online: false,
      now: NOW,
    });
    assert.ok(b);
    assert.equal(b.key, "offline");
    assert.equal(b.tone, "error");
  });

  void it("silence past UNREACHABLE_AFTER_MS reports the platform unreachable with the data's age", () => {
    const b = deriveBanner({
      status: status({}),
      lastHeardAt: NOW - UNREACHABLE_AFTER_MS - 130_000,
      online: true,
      now: NOW,
    });
    assert.ok(b);
    assert.equal(b.key, "unreachable");
    assert.match(b.text, /3 min ago/);
    assert.match(b.text, /retrying/);
    // Under the threshold, nothing (the server's own status decides).
    assert.equal(
      deriveBanner({
        status: status({}),
        lastHeardAt: NOW - UNREACHABLE_AFTER_MS,
        online: true,
        now: NOW,
      }),
      null,
    );
  });

  void it("never heard from the server yet is not 'unreachable' (initial load shows no scary banner)", () => {
    assert.equal(deriveBanner({ status: null, lastHeardAt: null, online: true, now: NOW }), null);
  });

  void it("a paused platform is an error banner carrying the server's message", () => {
    const b = deriveBanner({
      status: status({
        mode: "paused",
        trading: "paused",
        killSwitch: true,
        message: "Trading is paused by the operator.",
      }),
      lastHeardAt: NOW,
      online: true,
      now: NOW,
    });
    assert.ok(b);
    assert.equal(b.tone, "error");
    assert.equal(b.key, "paused");
    assert.equal(b.text, "Trading is paused by the operator.");
  });

  void it("a degraded platform is a warn banner keyed on what is degraded (so the same state does not re-announce)", () => {
    const a = deriveBanner({
      status: status({
        mode: "degraded",
        trading: "buys_halted",
        reads: "delayed",
        message: "Feed stale.",
      }),
      lastHeardAt: NOW,
      online: true,
      now: NOW,
    });
    const b = deriveBanner({
      status: status({
        mode: "degraded",
        trading: "buys_halted",
        reads: "delayed",
        message: "Feed stale.",
        generatedAt: NOW + 1,
      }),
      lastHeardAt: NOW,
      online: true,
      now: NOW,
    });
    assert.ok(a);
    assert.ok(b);
    assert.equal(a.tone, "warn");
    assert.equal(a.key, b.key);
    assert.equal(a.text, "Feed stale.");
  });
});

void describe("buysBlockedByStatus", () => {
  void it("only an operator pause blocks buys client-side; halts are per-game and the server refuses those itself", () => {
    assert.equal(buysBlockedByStatus(status({ trading: "paused" })), true);
    assert.equal(buysBlockedByStatus(status({ trading: "buys_halted" })), false);
    assert.equal(buysBlockedByStatus(null), false);
  });
});
