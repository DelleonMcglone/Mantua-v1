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
  await expect(page.getByText("Effective September 13, 2026")).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).toMatch(/0\.10% and 0\.70%/);
  expect(body).toMatch(/regular-season games carry no trading fee/i);
  expect(body).toMatch(/mandatory review window/i);
  expect(body).toMatch(/before and during the game/i);
  expect(body).toMatch(/fifty cents per contract/i);
  expect(body).toMatch(/connecting a bank account/i);
});

test("the Privacy page discloses bank connections and AI processing", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Privacy" }).first().click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).toMatch(/connect a bank account/i);
  expect(body).toMatch(/AI processing/);
  expect(body).toMatch(/Terms acceptances/);
});
