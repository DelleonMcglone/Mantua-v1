import { expect, test } from "@playwright/test";
import { launchApp, signIn } from "../harness.ts";
import { inThumbZone, mockMobileApi } from "./fixtures-mobile.ts";
import { TOUCH_TARGET_PX } from "../../src/lib/mobile.ts";
import { INTERACTION_MS } from "../../src/lib/mobile-budgets.ts";

/**
 * MX-002 — on a phone the ticket is a bottom sheet: price tap → the sheet
 * slides up with that side set → preset → Confirm, three taps, with
 * Confirm in the thumb zone and every control a full touch target.
 */
test("three taps to an executed trade, in a bottom sheet with Confirm under the thumb", async ({
  page,
  viewport,
}) => {
  const { state } = await mockMobileApi(page, { termsAccepted: true });
  await launchApp(page);
  await signIn(page);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "NFL", exact: true }).click();
  await expect(page.getByRole("heading", { name: "NFL" })).toBeVisible();
  await expect(page.getByTestId("trade-sheet")).toHaveCount(0);

  // Tap 1 — the price. The sheet opens with that side pressed.
  const price = page.getByRole("button", { name: "Trade Kansas City Chiefs", exact: true });
  const priceBox = await price.boundingBox();
  expect(priceBox?.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  const tapped = Date.now();
  await price.click();
  const sheet = page.getByTestId("trade-sheet");
  await expect(sheet).toBeVisible();
  expect(Date.now() - tapped).toBeLessThan(INTERACTION_MS + 1_000);
  await expect(sheet.locator("[data-side='1'][aria-pressed='true']")).toBeVisible();
  await expect(sheet.getByTestId("balance-line")).toContainText("$250.00");

  // Tap 2 — the amount. Presets are full-height targets.
  const preset = sheet.locator("[data-preset='100']");
  const presetBox = await preset.boundingBox();
  expect(presetBox?.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  await preset.click();
  await expect(sheet.getByTestId("fee-lines").locator("dd")).toHaveText([
    "$99.65",
    "$0.35",
    "0.35%",
    "$100.00",
  ]);

  // Tap 3 — Confirm, in the thumb zone.
  const confirm = sheet.getByTestId("confirm");
  await expect(confirm).toHaveText("Confirm buy");
  const box = await confirm.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  expect(inThumbZone(box ?? { y: 0, height: 0 }, viewport?.height ?? 0)).toBe(true);
  await confirm.click();
  await expect(sheet.getByTestId("trade-executed")).toContainText("Trade executed", {
    timeout: 20_000,
  });
  await expect.poll(() => state.fills).toBeGreaterThan(0);
});

test("a Discover price tap deep-links straight into the sheet on that side", async ({ page }) => {
  await mockMobileApi(page, { termsAccepted: true });
  await launchApp(page);
  await page.getByRole("button", { name: /^Browse all markets/ }).click();
  await page.getByRole("button", { name: "Trade Kansas City Chiefs", exact: true }).click();
  const sheet = page.getByTestId("trade-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-side='1'][aria-pressed='true']")).toBeVisible();
});
