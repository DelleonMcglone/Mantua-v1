import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cardSvg, renderCardPng, type Card } from "./card-image.ts";

const basket: Card = {
  kind: "basket",
  budgetUsdc: 100,
  placedUsdc: 96.4,
  leftoverUsdc: 3.6,
  legs: [
    {
      label: "Browns YES <script>",
      amountUsdc: 60,
      received: "150.00 YES",
      effectivePriceBps: 4000,
      status: "filled",
    },
    {
      label: "Raiders YES",
      amountUsdc: 36.4,
      received: null,
      effectivePriceBps: null,
      status: "failed",
    },
  ],
};
const research: Card = {
  kind: "research",
  budgetUsdc: null,
  rows: [
    { team: "Las Vegas Raiders", game: "Raiders at Patriots", priceBps: 3900, rating: "Lean YES" },
  ],
};

void describe("cardSvg", () => {
  void it("draws every leg with its amount, price and status, escaped", () => {
    const svg = cardSvg(basket);
    assert.match(svg, /Order filled · \$100\.00 basket/);
    assert.match(svg, /Browns YES &lt;script&gt;/);
    assert.ok(!svg.includes("<script>"));
    assert.match(svg, /\$60\.00/);
    assert.match(svg, /@ 40¢/);
    assert.match(svg, />Filled</);
    assert.match(svg, />Failed</);
    assert.match(svg, /\$96\.40 placed · \$3\.60 stays in the agent wallet/);
  });
  void it("draws the research summary with the rating pill and the disclaimer", () => {
    const svg = cardSvg(research);
    assert.match(svg, /Summary</);
    assert.match(svg, /Las Vegas Raiders/);
    assert.match(svg, /39¢/);
    assert.match(svg, /Lean YES/);
    assert.match(svg, /Not betting advice/);
  });
});

void describe("renderCardPng", () => {
  void it("rasterises to a PNG with the bundled font", async () => {
    const png = await renderCardPng(basket);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(png.length > 10_000);
  });
});
