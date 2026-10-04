import { expect, test } from "@playwright/test";
import { mockApi } from "./harness.ts";

/**
 * The pre-launch landing page at `/waitlist`: the home header without
 * help / login / sign-up, the brand hero, one email field that posts to
 * `/api/waitlist`, the demo-video slot, and the home footer.
 */
test("the waitlist page takes an email and confirms it, with no login or help in the header", async ({
  page,
}) => {
  await mockApi(page);
  const posted: unknown[] = [];
  await page.route("**/api/waitlist", async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, already: false } });
  });
  await page.goto("/waitlist");

  await expect(page.getByTestId("waitlist-page")).toBeVisible();
  await expect(page.getByRole("img", { name: "Mantua" }).last()).toBeVisible();
  await expect(page.getByText("Programmable")).toBeVisible();
  const header = page.locator("header");
  await expect(header.getByRole("button", { name: "Toggle theme" })).toBeVisible();
  await expect(header.getByRole("button", { name: /log in|sign up|help/i })).toHaveCount(0);
  await expect(page.getByTestId("waitlist-video")).toContainText("Demo video coming soon");
  await expect(page.getByRole("button", { name: "Terms of Use" })).toBeVisible();

  const join = page.getByRole("button", { name: "Join the waitlist" });
  await expect(join).toBeDisabled();
  await page.getByLabel("Email address").fill("Fan@Example.com");
  await join.click();
  await expect(page.getByTestId("waitlist-done")).toContainText("You're on the list");
  expect(posted).toEqual([{ email: "Fan@Example.com", source: "landing" }]);
  expect(new URL(page.url()).pathname).toBe("/waitlist");
});

test("a repeat email is told it is already on the list", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/waitlist", (route) =>
    route.fulfill({ json: { ok: true, already: true } }),
  );
  await page.goto("/waitlist");
  await page.getByLabel("Email address").fill("fan@example.com");
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByTestId("waitlist-done")).toContainText("already on the list");
});
