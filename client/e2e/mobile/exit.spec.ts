import { expect, test } from "@playwright/test";
import { launchApp, signIn } from "../harness.ts";
import { mockMobileApi } from "./fixtures-mobile.ts";
import { TOUCH_TARGET_PX } from "../../src/lib/mobile.ts";

/**
 * MX-001 / MX-003 / MX-008 — monitoring and leaving a live position on a
 * phone: the league page's live glance shows the score, the held side's
 * price now, its value and P&L in one card, and "Lock in" opens the sheet
 * on Sell with the whole balance, so the exit is two taps (Sell → Confirm).
 */
test("the live glance shows score, position and price together, and exits in two taps", async ({
  page,
}) => {
  const { state } = await mockMobileApi(page, {
    termsAccepted: true,
    liveGame: true,
    position: true,
  });
  await launchApp(page);
  await signIn(page);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "NFL", exact: true }).click();

  const glance = page.getByTestId("live-glance");
  await expect(glance).toBeVisible();
  const row = glance.getByTestId("glance-row").first();
  await expect(row.getByTestId("glance-score")).toHaveText("KC 14 · LV 10");
  await expect(row.getByTestId("glance-prices")).toHaveText("KC 50¢ · LV 50¢");
  const position = row.getByTestId("glance-position");
  await expect(position).toContainText("You hold 200.00 KC");
  await expect(position).toContainText("now 50¢");
  await expect(position).toContainText("≈ $100.00");
  await expect(position).toContainText("(+$10.00)");

  // Tap 1 — Sell (reads "Lock in" while the position is up).
  const sell = row.getByTestId("glance-sell");
  await expect(sell).toHaveText("Lock in");
  expect((await sell.boundingBox())?.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  await sell.click();
  const sheet = page.getByTestId("trade-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-direction='sell']")).toHaveClass(/font-semibold/);
  await expect(sheet.getByLabel("Contracts to sell")).toHaveValue("200");

  // Tap 2 — Confirm.
  const confirm = sheet.getByTestId("confirm");
  await expect(confirm).toHaveText("Confirm sell");
  await confirm.click();
  await expect(sheet.getByTestId("trade-executed")).toContainText("Trade executed", {
    timeout: 20_000,
  });
  await expect.poll(() => state.fills).toBeGreaterThan(0);
});

test("the phone profile is four tabs, positions first, with a full-height Close", async ({
  page,
}) => {
  await mockMobileApi(page, { termsAccepted: true, position: true });
  await launchApp(page);
  await signIn(page);
  // The wallet menu's trigger reads as the shortened address.
  await page.getByRole("button", { name: /^0x00/ }).click();
  await page.getByRole("menuitem", { name: /profile/i }).click();
  const profile = page.getByTestId("mobile-profile");
  await expect(profile).toBeVisible();
  for (const tab of ["positions", "portfolio", "agent", "account"]) {
    const t = profile.getByTestId(`profile-tab-${tab}`);
    await expect(t).toBeVisible();
    expect((await t.boundingBox())?.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  }
  await expect(profile.getByTestId("profile-tab-positions")).toHaveAttribute(
    "data-state",
    "active",
  );
  const close = profile.getByRole("button", { name: /^Close position/ });
  await expect(close).toBeVisible();
  expect((await close.boundingBox())?.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  await profile.getByTestId("profile-tab-account").click();
  await expect(profile.getByTestId("notifications")).toBeVisible();
});
