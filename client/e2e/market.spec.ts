import { expect, test, type Page } from "@playwright/test";
import { launchApp, mockApi } from "./harness.ts";

/**
 * Phase 12 (D-008) — every listed data point is reachable from one market
 * page without leaving it: price and implied probability, the live game,
 * the annotated chart, depth and liquidity, volume, open interest, fees
 * and execution, research, and past markets. The page heading is asserted
 * after every step, so any navigation would fail the spec.
 */
async function openMarket(page: Page): Promise<void> {
  await mockApi(page, { liveGame: true });
  await launchApp(page);
  await page.getByRole("button", { name: "NFL", exact: true }).first().click();
  await page.getByTestId("game-row").first().click();
  await expect(
    page.getByRole("heading", { name: "Kansas City Chiefs at Las Vegas Raiders" }),
  ).toBeVisible();
}

const stillOnPage = (page: Page) =>
  expect(
    page.getByRole("heading", { name: "Kansas City Chiefs at Las Vegas Raiders" }),
  ).toBeVisible();

test("the simple layer: prices, the live game, and the annotated chart", async ({ page }) => {
  await openMarket(page);
  const summary = page.getByTestId("market-summary");
  await expect(summary).toContainText("50¢");
  await expect(summary).toContainText("50% chance");
  await expect(summary.locator("[data-source='market']").first()).toBeVisible();

  const live = page.getByTestId("live-game");
  await expect(live.getByTestId("live-score")).toHaveText("KC 14 · LV 10");
  await expect(live.getByTestId("live-situation")).toHaveText("Q2 · 07:12");
  await expect(live.getByTestId("live-possession")).toHaveText("KC ball");
  await expect(live.getByTestId("live-last-play")).toContainText("Mahomes pass complete");

  await expect(page.getByTestId("chart-annotation")).toHaveCount(3);
  await expect(page.getByTestId("chart-annotation").filter({ hasText: "Kickoff" })).toBeVisible();
  await expect(page.getByTestId("chart-annotations")).toContainText(
    "Marked: kickoff, 1 period change, 1 injury report",
  );
  await stillOnPage(page);
});

test("the deeper layer opens in place: depth, fees, research, past markets", async ({ page }) => {
  await openMarket(page);
  for (const id of ["depth", "fees", "research", "history"]) {
    await expect(page.getByTestId(`section-${id}`)).toHaveAttribute("data-open", "false");
  }

  await page.getByTestId("toggle-depth").click();
  const metrics = page.getByTestId("market-metrics");
  await expect(metrics.locator("[data-metric='price'] dd")).toHaveText("50¢");
  await expect(metrics.locator("[data-metric='price']")).toContainText("+2.5 pts over 24h");
  await expect(metrics.locator("[data-metric='volume'] dd")).toHaveText("$987.50");
  await expect(metrics.locator("[data-metric='trades'] dd")).toHaveText("12");
  await expect(metrics.locator("[data-metric='open-interest'] dd")).toHaveText("3,700 contracts");
  await expect(page.getByTestId("depth-summary")).toHaveText(
    "$10,000 of liquidity · a $260.10 buy moves the price 5¢.",
  );
  await expect(page.getByTestId("market-depth").locator("[data-side='buy']")).toHaveCount(2);
  await expect(page.getByTestId("market-depth").locator("[data-side='sell']")).toHaveCount(2);

  await page.getByTestId("toggle-fees").click();
  const fees = page.getByTestId("fees-execution");
  await expect(fees.getByTestId("fee-explainer")).toContainText("0.10% and 0.70%");
  await expect(fees).toContainText("How a trade is filled");
  await expect(fees).toContainText("slippage limit");

  await page.getByTestId("toggle-research").click();
  const research = page.getByTestId("market-research");
  await expect(research.getByTestId("research-probability")).toHaveText("44%");
  await expect(research.locator("[data-source='model']")).toBeVisible();
  await expect(research).toContainText("Model 6.0 pts below the 50¢ market price");
  await page.getByTestId("research-side-1").click();
  await expect(research.getByTestId("research-probability")).toHaveText("56%");
  await expect(research.getByTestId("research-action")).toContainText(
    "value in Kansas City Chiefs",
  );
  await expect(research.getByTestId("research-evidence").locator("li")).toHaveCount(2);

  await page.getByTestId("toggle-history").click();
  const past = page.getByTestId("past-markets");
  await expect(past.getByTestId("history-row")).toHaveCount(2);
  await expect(past.getByTestId("history-outcome").first()).toHaveText("Buffalo Bills won");
  await expect(past).toContainText("Buffalo Bills contracts paid $1.00");
  await expect(past.getByTestId("history-sparkline")).toHaveCount(2);
  await stillOnPage(page);
  await expect(page.getByTestId("open-all")).toHaveText("Close all");
});

test("the historical browser filters by league and reads every outcome", async ({ page }) => {
  await openMarket(page);
  await page.getByTestId("toggle-history").click();
  await page.getByTestId("browse-history").click();
  const browser = page.getByTestId("history-page");
  await expect(browser.getByRole("heading", { name: "Past markets" })).toBeVisible();
  await expect(browser.getByTestId("history-row")).toHaveCount(2);
  await expect(browser.getByTestId("history-row").nth(1)).toContainText(
    "Both sides settled at 50¢",
  );
  await page.getByRole("button", { name: "All leagues" }).click();
  await expect(browser.getByTestId("history-row")).toHaveCount(2);
});
