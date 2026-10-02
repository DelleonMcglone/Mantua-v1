import { expect, test } from "@playwright/test";
import { launchApp, mockApi } from "./harness.ts";

/**
 * The league page's list controls (owner walkthrough, 2026-10-02): step to
 * the previous or next week without opening the dropdown, and flip the order
 * the games run in so the most recent are on top.
 */
test("week arrows step through the weeks and the order toggle reverses the games", async ({
  page,
}) => {
  await mockApi(page);
  await launchApp(page);
  await page.getByRole("button", { name: "NFL", exact: true }).first().click();

  const rows = page.getByTestId("game-row");
  await expect(rows.first()).toBeVisible();
  const earliestFirst = await rows.allInnerTexts();

  await page.getByRole("button", { name: /Game order: earliest first/ }).click();
  await expect(page.getByRole("button", { name: /Game order: latest first/ })).toBeVisible();
  const latestFirst = await rows.allInnerTexts();
  if (earliestFirst.length > 1) expect(latestFirst).toEqual([...earliestFirst].reverse());

  // The choice survives a reload.
  await page.reload();
  await page.getByRole("button", { name: "NFL", exact: true }).first().click();
  await expect(page.getByRole("button", { name: /Game order: latest first/ })).toBeVisible();

  // Next week, and back again, with no dropdown.
  await expect(page.getByRole("button", { name: "This week" })).toBeVisible();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(page.getByRole("button", { name: "This week" })).toHaveCount(0);
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(page.getByRole("button", { name: "This week" })).toBeVisible();
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(page.getByRole("button", { name: "Last week" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous week" })).toBeDisabled();

  await page.screenshot({ path: "test-results/league-controls.png" });
});
