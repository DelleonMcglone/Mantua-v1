import { expect, test } from "@playwright/test";
import { mockMobileApi } from "./fixtures-mobile.ts";
import {
  FIRST_MARKET_ROW_MS,
  MID_TIER_CPU_SLOWDOWN,
  MID_TIER_NETWORK,
  WARM_FIRST_MARKET_ROW_MS,
} from "../../src/lib/mobile-budgets.ts";

/**
 * MX-006 — the load budget on a mid-tier phone over a fair connection
 * (mobile-budgets.ts), measured on the production build: from navigation
 * to the first tappable market row, cold and then warm.
 */
test("the first market row lands inside budget on a throttled mid-tier profile, cold and warm", async ({
  page,
}) => {
  test.slow();
  await mockMobileApi(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: (MID_TIER_NETWORK.downloadKbps * 1024) / 8,
    uploadThroughput: (MID_TIER_NETWORK.uploadKbps * 1024) / 8,
    latency: MID_TIER_NETWORK.latencyMs,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: MID_TIER_CPU_SLOWDOWN });

  const measure = async (): Promise<number> => {
    const started = Date.now();
    await page.goto("/?open=discover", { waitUntil: "commit" });
    await page.getByTestId("discover-row").first().waitFor({ state: "visible", timeout: 60_000 });
    return Date.now() - started;
  };

  const cold = await measure();
  // The service worker has now cached the shell and the hashed assets.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  const warm = await measure();

  test.info().annotations.push({ type: "cold-ms", description: String(cold) });
  test.info().annotations.push({ type: "warm-ms", description: String(warm) });
  console.log(`[mobile-budget] first market row: cold ${String(cold)} ms, warm ${String(warm)} ms`);
  expect(cold, `cold load ${String(cold)} ms`).toBeLessThan(FIRST_MARKET_ROW_MS);
  expect(warm, `warm load ${String(warm)} ms`).toBeLessThan(WARM_FIRST_MARKET_ROW_MS);
});
