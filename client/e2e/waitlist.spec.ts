import { expect, test } from "@playwright/test";
import { mockApi } from "./harness.ts";

/**
 * The landing page at `/waitlist`: the home header with Log in / Sign up
 * (no help, no theme toggle), the brand hero, the demo video, and the
 * home footer. Login happens from here (owner, 2026-10-21); the waitlist
 * form is gone.
 */
test("the landing page offers login and sign-up in the header, the hero and the demo", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/waitlist");

  await expect(page.getByTestId("waitlist-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Programmable Sports Agents/ })).toBeAttached();
  await expect(page.locator('img[src="/assets/waitlist-hero.png"]')).toBeVisible();
  await expect(page.getByText("Trade sports prediction markets with AI agents.")).toBeVisible();
  const header = page.locator("header");
  await expect(header.getByRole("button", { name: /log in/i })).toBeVisible();
  await expect(header.getByRole("button", { name: /sign up/i })).toBeVisible();
  await expect(header.getByRole("button", { name: /help|toggle theme/i })).toHaveCount(0);
  await expect(page.getByTestId("waitlist-video")).toHaveAttribute(
    "src",
    /youtube-nocookie\.com\/embed\/siArImNtatM/,
  );
  await expect(page.getByRole("button", { name: "Terms of Use" })).toBeVisible();
  await expect(page.getByTestId("waitlist-form")).toHaveCount(0);
  await expect(page.getByText("Join the waitlist")).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/waitlist");
});
