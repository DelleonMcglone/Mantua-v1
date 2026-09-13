import { expect, test } from "@playwright/test";
import { launchApp, mockApi, signIn } from "./harness.ts";

/**
 * G-001 — every failure state reads as copy in the browser (T-012), the
 * platform pause reaches the ticket (R-005), and browsing never demands a
 * login while trading does (B5-007).
 */
async function openTicket(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "NFL", exact: true }).first().click();
  await page.getByRole("button", { name: "Trade Kansas City Chiefs", exact: true }).click();
  await page.getByTestId("trade-ticket").locator("[data-preset='10']").click();
}

test("a halted feed shows the halted copy, not a stack trace", async ({ page }) => {
  await mockApi(page, {
    quoteError: { status: 503, code: "TRADING_HALTED", error: "feed 700000ms behind" },
    termsAccepted: true,
  });
  await launchApp(page);
  await signIn(page);
  await openTicket(page);
  const error = page.getByTestId("trade-error");
  await expect(error).toHaveAttribute("data-error-kind", "halted");
  await expect(error).toContainText("Buying is paused");
  await expect(error).not.toContainText("700000");
});

test("undeployed markets read as opening soon", async ({ page }) => {
  await mockApi(page, {
    quoteError: { status: 503, code: "MARKETS_NOT_DEPLOYED", error: "not deployed" },
    termsAccepted: true,
  });
  await launchApp(page);
  await signIn(page);
  await openTicket(page);
  await expect(page.getByTestId("trade-error")).toContainText("Markets are opening soon");
});

test("a platform pause disables Confirm and says so", async ({ page }) => {
  await mockApi(page, { paused: true, termsAccepted: true });
  await launchApp(page);
  await signIn(page);
  await openTicket(page);
  await expect(page.getByTestId("confirm")).toHaveText("Trading paused");
  await expect(page.getByTestId("confirm")).toBeDisabled();
});

test("logged out: browsing works and the ticket asks to log in", async ({ page }) => {
  await mockApi(page);
  await launchApp(page);
  await page.getByRole("button", { name: "NFL", exact: true }).first().click();
  await page.getByRole("button", { name: "Trade Kansas City Chiefs", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log in to trade" })).toBeVisible();
  await expect(page.getByTestId("terms-gate")).toHaveCount(0);
});
