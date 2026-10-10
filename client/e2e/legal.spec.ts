import { expect, test } from "@playwright/test";
import { mockApi } from "./harness.ts";

/**
 * G-012 / G-013 — the published legal pages describe the shipped product
 * and carry the version users accept.
 */
test("the Terms page carries the current version, the fee model, and the review window", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Terms of Use" }).first().click();
  await expect(page.getByRole("heading", { name: "Terms of Use" })).toBeVisible();
  await expect(page.getByText("Effective October 2, 2026")).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).toMatch(/0\.10% and 0\.70%/);
  expect(body).toMatch(/regular-season and playoff games alike/i);
  expect(body).toMatch(/mandatory review window/i);
  expect(body).toMatch(/before and during the game/i);
  expect(body).toMatch(/fifty cents per contract/i);
  // D-123 — USDC in, USDC out; no bank, swap or liquidity-provision wording.
  expect(body).toMatch(/Mantua works in one asset, USDC/i);
  expect(body).toMatch(/We do not accept dollars, connect bank accounts/i);
  expect(body).not.toMatch(/swap assets|provide liquidity|payments partners|impermanent loss/i);
});

test("the Privacy page discloses AI processing and holds no bank data", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Privacy" }).first().click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/bank|Plaid|swaps|liquidity provided/i);
  expect(body).toMatch(/AI processing/);
  expect(body).toMatch(/Terms acceptances/);
});
