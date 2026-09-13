import { expect, test } from "@playwright/test";
import { launchApp, mockApi } from "./harness.ts";

/**
 * G-001 — Discover in a real browser: a typed phrase lands on the same
 * page a tap does, filters edit the title, every price carries its
 * source, the freshness stamp is present, and a price tap opens the
 * league page with that side already in the ticket (T-001/T-018/T-019/
 * T-021/T-023).
 */
test("a typed discovery phrase lands on Discover with the parsed filters", async ({ page }) => {
  await mockApi(page);
  await launchApp(page);
  const dock = page.getByRole("textbox", { name: /ask mantua/i });
  await dock.fill("What can I trade this week?");
  await dock.press("Enter");

  await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible();
  await expect(page.getByTestId("discover-title")).toHaveText("Open now · this week");
  // Only the market with a live pool is open; the quiet game is filtered out.
  await expect(page.getByTestId("discover-row")).toHaveCount(1);
  await expect(page.getByTestId("freshness").first()).toContainText("Updated");
  await expect(page.locator("[data-source='market']").first()).toHaveText(/market price/i);
});

test("filter chips edit the same filter object and a price tap opens the ticket on that side", async ({
  page,
}) => {
  await mockApi(page);
  await launchApp(page);
  await page.getByRole("button", { name: /^Browse all markets/ }).click();
  await expect(page.getByTestId("discover-title")).toHaveText("Open now");

  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByTestId("discover-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Liquidity", exact: true }).click();
  await expect(page.getByTestId("discover-title")).toHaveText("most liquid");

  await page.getByRole("button", { name: "Trade Kansas City Chiefs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "NFL" })).toBeVisible();
  const ticket = page.getByTestId("trade-ticket");
  await expect(ticket).toContainText("Kansas City Chiefs");
  await expect(ticket.locator("[data-side='1'][aria-pressed='true']")).toBeVisible();
});
