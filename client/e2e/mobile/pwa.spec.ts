import { expect, test } from "@playwright/test";
import { launchApp } from "../harness.ts";
import { mockMobileApi } from "./fixtures-mobile.ts";

/**
 * MX-007 / MX-004 — the installable shell: a valid manifest with icons and
 * shortcuts, the theme colour, the service worker registered at the root
 * scope, and the launch route (`?open=…`) landing on the named surface.
 */
test("the app is installable: manifest, icons, meta, and a registered service worker", async ({
  page,
}) => {
  await mockMobileApi(page);
  await page.goto("/");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/manifest.webmanifest");
  const manifest = (await (await page.request.get("/manifest.webmanifest")).json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose?: string }[];
    shortcuts: { url: string }[];
  };
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/?source=pwa");
  expect(manifest.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    expect((await page.request.get(icon.src)).status(), icon.src).toBe(200);
  }
  expect(manifest.shortcuts.map((s) => s.url)).toContain("/?source=pwa&open=discover");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#000000");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
  const scope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.scope;
  });
  expect(scope).toBe("http://localhost:4173/");
  const sw = await page.request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain("notificationclick");
});

test("a notification or shortcut URL opens the named surface and cleans the address bar", async ({
  page,
}) => {
  await mockMobileApi(page, { liveGame: true });
  await page.goto("/?source=pwa&open=market&league=nfl&event=401547401&side=1");
  // The deep link lands in the sheet, on that side; the league page is behind it.
  const sheet = page.getByTestId("trade-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Kansas City Chiefs");
  await expect(sheet.locator("[data-side='1'][aria-pressed='true']")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "NFL" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.search)).toBe("");

  await page.goto("/?open=discover");
  await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible();
  await page.goto("/?source=pwa");
  await expect(page.getByRole("button", { name: /^Browse all markets/ })).toBeVisible();
});

test("notifications settings read the deployment's push state and never subscribe on load", async ({
  page,
  context,
}) => {
  // Headless Chromium reports `Notification.permission` as "denied" whatever
  // the context grants; a real phone that has not been asked reads "default".
  // Pin that so the state under test is "off" (allowed to ask, not subscribed).
  await context.grantPermissions(["notifications"], { origin: "http://localhost:4173" });
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "default" });
  });
  await mockMobileApi(page, { termsAccepted: true, push: true });
  await launchApp(page);
  await page.goto("/?open=profile");
  const profile = page.getByTestId("mobile-profile");
  await profile.getByTestId("profile-tab-account").click();
  const section = profile.getByTestId("notifications");
  await expect(section).toHaveAttribute("data-state", "off");
  await expect(section.getByTestId("push-toggle")).toHaveText("Turn on notifications");
  // Nothing subscribed on load: the browser holds no push subscription.
  const subscribed = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) !== null;
  });
  expect(subscribed).toBe(false);
});

test("without keys on the deployment the settings say so and offer nothing", async ({ page }) => {
  await mockMobileApi(page, { termsAccepted: true, push: false });
  await page.goto("/?open=profile");
  const profile = page.getByTestId("mobile-profile");
  await profile.getByTestId("profile-tab-account").click();
  const section = profile.getByTestId("notifications");
  await expect(section).toHaveAttribute("data-state", "server-off");
  await expect(section.getByTestId("push-toggle")).toHaveCount(0);
});
