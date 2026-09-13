import { expect, test } from "@playwright/test";
import { launchApp, mockApi, signIn } from "./harness.ts";

/**
 * G-001 — the trade journey in a real browser: price tap → preset →
 * (first-ever: accept the Terms) → Confirm → an explicit "Trade executed"
 * card, with the review block showing the hook's exact numbers and no
 * chain vocabulary anywhere on the ticket (T-002/T-006/T-008/G-014).
 */
const CHAIN_WORDS = /\b(gas|ETH|on-?chain|blockchain|network|mainnet|explorer)\b/i;

test("three taps to an executed trade, with the Terms accepted once on the way", async ({
  page,
}) => {
  const { state } = await mockApi(page);
  await launchApp(page);
  await signIn(page);
  await page.getByRole("button", { name: "NFL", exact: true }).first().click();

  // Tap 1 — the price.
  await page.getByRole("button", { name: "Trade Kansas City Chiefs", exact: true }).click();
  const ticket = page.getByTestId("trade-ticket");
  await expect(ticket).toContainText("Kansas City Chiefs");
  await expect(page.getByTestId("balance-line")).toContainText("$250.00");

  // Tap 2 — the amount.
  await ticket.locator("[data-preset='100']").click();
  const lines = page.getByTestId("fee-lines");
  await expect(lines).toContainText("Position");
  await expect(lines.locator("dd")).toHaveText(["$99.65", "$0.35", "0.35%", "$100.00"]);
  await expect(page.getByTestId("you-get")).toContainText("200.00 contracts");

  // First trade ever: the one-time Terms gate stands in for Confirm.
  await expect(page.getByTestId("terms-gate")).toBeVisible();
  await page.getByTestId("accept-terms").click();
  expect(state.termsAccepted).toBe(true);

  // Tap 3 — Confirm.
  const confirm = page.getByTestId("confirm");
  await expect(confirm).toHaveText("Confirm buy");
  await confirm.click();

  const executed = page.getByTestId("trade-executed");
  await expect(executed).toBeVisible({ timeout: 20_000 });
  await expect(executed).toContainText("Trade executed");
  await expect(executed).toContainText("200.00 Kansas City Chiefs contracts for $100.00 at 50¢");
  await expect.poll(() => state.fills).toBeGreaterThan(0);

  const text = await ticket.innerText();
  expect(text).not.toMatch(CHAIN_WORDS);
});

test("a returning user who accepted the current Terms goes straight to Confirm", async ({
  page,
}) => {
  await mockApi(page, { termsAccepted: true });
  await launchApp(page);
  await signIn(page);
  await page.getByRole("button", { name: "NFL", exact: true }).first().click();
  await page.getByRole("button", { name: "Trade Kansas City Chiefs", exact: true }).click();
  await page.getByTestId("trade-ticket").locator("[data-preset='25']").click();
  await expect(page.getByTestId("terms-gate")).toHaveCount(0);
  await expect(page.getByTestId("confirm")).toBeEnabled();
});
