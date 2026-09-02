import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMarketId, moneylineMarketIds, InvalidMarketIdInputError } from "./market-id.ts";

void describe("computeMarketId", () => {
  void it("is deterministic — the same input always yields the same id", () => {
    const input = {
      providerEventId: "401671789",
      marketType: "moneyline" as const,
      outcomeIndex: 0,
    };
    assert.equal(computeMarketId(input), computeMarketId(input));
  });

  void it("returns a 32-byte hex string", () => {
    const id = computeMarketId({
      providerEventId: "401671789",
      marketType: "moneyline",
      outcomeIndex: 0,
    });
    assert.match(id, /^0x[0-9a-f]{64}$/);
  });

  void it("distinguishes the two sides of one game", () => {
    const { home, away } = moneylineMarketIds("401671789");
    assert.notEqual(home, away);
  });

  void it("distinguishes two games", () => {
    const a = computeMarketId({
      providerEventId: "401671789",
      marketType: "moneyline",
      outcomeIndex: 0,
    });
    const b = computeMarketId({
      providerEventId: "401671790",
      marketType: "moneyline",
      outcomeIndex: 0,
    });
    assert.notEqual(a, b);
  });

  void it("normalises casing and surrounding whitespace", () => {
    const canonical = computeMarketId({
      providerEventId: "nfl-401671789",
      marketType: "moneyline",
      outcomeIndex: 0,
    });
    for (const variant of ["NFL-401671789", "  nfl-401671789  ", "Nfl-401671789"]) {
      assert.equal(
        computeMarketId({ providerEventId: variant, marketType: "moneyline", outcomeIndex: 0 }),
        canonical,
        `expected ${variant} to normalise to the canonical id`,
      );
    }
  });

  void it("cannot collide across field boundaries", () => {
    // The reason for ABI encoding rather than string concatenation: with a
    // "-" separator these two would both produce "nfl-1-moneyline-2".
    const a = computeMarketId({
      providerEventId: "nfl-1",
      marketType: "moneyline",
      outcomeIndex: 2,
    });
    const b = computeMarketId({
      providerEventId: "nfl",
      marketType: "moneyline",
      outcomeIndex: 12,
    });
    assert.notEqual(a, b);
  });

  void it("rejects an empty event id", () => {
    assert.throws(
      () => computeMarketId({ providerEventId: "   ", marketType: "moneyline", outcomeIndex: 0 }),
      InvalidMarketIdInputError,
    );
  });

  void it("rejects a negative or fractional outcome index", () => {
    for (const outcomeIndex of [-1, 1.5]) {
      assert.throws(
        () =>
          computeMarketId({ providerEventId: "401671789", marketType: "moneyline", outcomeIndex }),
        InvalidMarketIdInputError,
      );
    }
  });
});
