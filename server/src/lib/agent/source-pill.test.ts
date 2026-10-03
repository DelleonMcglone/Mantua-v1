import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { providerLabel } from "./source-pill.ts";

void describe("providerLabel", () => {
  void it("names the provider from the service host", () => {
    assert.equal(providerLabel("https://api.exa.ai/search"), "Exa");
    assert.equal(providerLabel("https://www.dripstack.io/v1/flow"), "Dripstack");
    assert.equal(providerLabel("https://massive.com/market"), "Massive");
  });
  void it("falls back for anything that is not a URL", () => {
    assert.equal(providerLabel("not a url"), "Paid service");
    assert.equal(providerLabel(undefined), "Paid service");
  });
});
