import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moveOverWindow, rationaleFrom, ratingFor } from "./market-summary.ts";

void describe("ratingFor", () => {
  void it("maps the analysis to the four card ratings", () => {
    assert.equal(
      ratingFor({ suggested: "consider_buy_yes", priceBps: 5500, liquidityUsdc: 200 }),
      "Lean YES",
    );
    assert.equal(
      ratingFor({ suggested: "consider_fade", priceBps: 5500, liquidityUsdc: 200 }),
      "Lean NO",
    );
    assert.equal(ratingFor({ suggested: "hold", priceBps: 5500, liquidityUsdc: 200 }), "Fair");
  });
  void it("calls a shallow market Thin whatever the edge says", () => {
    assert.equal(
      ratingFor({ suggested: "consider_buy_yes", priceBps: 5500, liquidityUsdc: 4 }),
      "Thin",
    );
  });
  void it("has no rating without a price", () => {
    assert.equal(
      ratingFor({ suggested: "consider_buy_yes", priceBps: null, liquidityUsdc: null }),
      "No price",
    );
  });
});

void describe("moveOverWindow", () => {
  const now = new Date("2026-10-03T18:00:00Z");
  const at = (h: number, p: string) => ({
    impliedProbability: p,
    capturedAt: new Date(now.getTime() - h * 3_600_000),
  });
  void it("is the latest price minus the oldest capture inside the window, in points", () => {
    assert.equal(moveOverWindow([at(1, "0.58"), at(20, "0.52"), at(30, "0.40")], now), 6);
  });
  void it("is null with fewer than two captures in the window", () => {
    assert.equal(moveOverWindow([at(1, "0.58"), at(30, "0.40")], now), null);
    assert.equal(moveOverWindow([], now), null);
  });
});

void describe("rationaleFrom", () => {
  void it("takes the top evidence line and keeps it to one card line", () => {
    assert.equal(rationaleFrom([{ factor: "record", detail: "7-3 vs 4-6" }]), "record: 7-3 vs 4-6");
    assert.equal(rationaleFrom([]), "No evidence beyond the price.");
    const long = rationaleFrom([{ factor: "form", detail: "x".repeat(200) }]);
    assert.ok(long.length <= 110);
    assert.ok(long.endsWith("…"));
  });
});
