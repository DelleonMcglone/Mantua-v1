import { expect, test } from "@playwright/test";
import { launchApp } from "../harness.ts";
import { mockMobileApi } from "./fixtures-mobile.ts";
import { TOUCH_TARGET_PX } from "../../src/lib/mobile.ts";

/**
 * MX-001 — sport switching and market discovery on a phone: a league is
 * one tap from any league page (the chip row), every market is one tap
 * from home, and the dock's controls are full touch targets.
 */
test("switching sport is one tap on the league page, and every chip is a touch target", async ({
  page,
}) => {
  await mockMobileApi(page);
  await launchApp(page);
  // Task 075 (HP-008) — the home page's new footer holds the phone width
  // (360/430 px) with no horizontal overflow.
  await expect(
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).resolves.toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "NFL", exact: true }).click();
  await expect(page.getByRole("heading", { name: "NFL" })).toBeVisible();

  const chips = page.getByRole("navigation", { name: "Switch sport" });
  await expect(chips).toBeVisible();
  await expect(chips.locator("[data-sport-chip='nfl']")).toHaveAttribute("aria-current", "page");
  for (const chip of await chips.getByRole("button").all()) {
    expect((await chip.boundingBox())?.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  }
  // Every listed league is a chip; NFL is live, the rest open the
  // coming-soon page rather than a market.
  await expect(chips.getByRole("button")).toHaveCount(12);
  await chips.locator("[data-sport-chip='nba']").click();
  await expect(page.getByRole("heading", { name: "NBA — coming soon" })).toBeVisible();
});

test("all markets are one tap from home, and the dock's mic and send are 44 px", async ({
  page,
}) => {
  await mockMobileApi(page);
  await launchApp(page);
  await page.getByRole("button", { name: /^Browse all markets/ }).click();
  await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible();
  await expect(page.getByTestId("discover-row")).toHaveCount(1);

  const input = page.getByTestId("command-input");
  await expect(input).toHaveAttribute("enterkeyhint", "send");
  expect(
    await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  for (const name of ["Send", "Hold to speak"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box?.width, name).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
    expect(box?.height, name).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  }
  // No horizontal overflow at any phone width.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
