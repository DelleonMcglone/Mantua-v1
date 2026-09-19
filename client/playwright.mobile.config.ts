import { defineConfig, devices } from "@playwright/test";
import { MOBILE_VIEWPORTS } from "./src/lib/mobile-budgets.ts";

/**
 * Task 071 (Phase 15) — the mobile browser suite. Unlike playwright.config.ts
 * this runs the PRODUCTION build under `vite preview`, because the numbers
 * it enforces (bytes on the wire, time to the first market row, the
 * service worker, the manifest) only exist in a built bundle. The same
 * shims apply: the auth SDK is replaced at build time (VITE_E2E_AUTH=shim)
 * and every API route is scripted per spec through `mockApi`.
 *
 * Two projects bracket the market: a small Android (360 × 740, the entry
 * tier) and a large phone (430 × 932). Both are Chromium with touch and a
 * mobile user agent, so CI needs only the browser it already installs.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const pixel = devices["Pixel 7"];

export default defineConfig({
  testDir: "./e2e/mobile",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: "mobile-small",
      use: { ...pixel, viewport: MOBILE_VIEWPORTS.small, deviceScaleFactor: 2 },
    },
    {
      name: "mobile-large",
      use: { ...pixel, viewport: MOBILE_VIEWPORTS.large, deviceScaleFactor: 3 },
    },
  ],
  webServer: {
    command: "npx vite build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      VITE_E2E_AUTH: "shim",
      VITE_PRIVY_APP_ID: "e2e-shim",
      VITE_API_BASE_URL: "",
      VITE_BASE_RPC_URL: "http://localhost:4173/__e2e/rpc",
      VITE_GASLESS_ENABLED: "",
    },
  },
});
