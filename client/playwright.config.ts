import { defineConfig, devices } from "@playwright/test";

/**
 * Task 067 (G-001 / G-002) — the browser E2E suite. Runs the real client
 * (Vite dev server) with the authentication SDK shimmed
 * (`VITE_E2E_AUTH=shim`, see e2e/privy-shim.tsx) and the chain answered
 * by `/__e2e/rpc`, which each spec scripts through `mockApi`. No Privy
 * app id, database, or chain is needed.
 *
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points the run at a preinstalled
 * Chromium (a sandbox without network); CI installs Playwright's own.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e",
  // Task 071 — the phone suite has its own config (production build, two
  // mobile projects): playwright.mobile.config.ts.
  testIgnore: /e2e[\\/]mobile[\\/]/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 45_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_E2E_AUTH: "shim",
      VITE_PRIVY_APP_ID: "e2e-shim",
      VITE_API_BASE_URL: "",
      VITE_BASE_RPC_URL: "http://localhost:5173/__e2e/rpc",
      VITE_GASLESS_ENABLED: "",
    },
  },
});
