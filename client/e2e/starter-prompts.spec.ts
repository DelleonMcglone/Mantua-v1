import { expect, test } from "@playwright/test";
import { launchApp, mockApi } from "./harness.ts";

/**
 * The analyst's starter cards (owner, 2026-10-03): five prompts in workflow
 * order. One without a blank sends at once; one with a blank lands in the
 * dock to be completed.
 */
test("the first five prompts: a complete prompt sends, a prompt with a blank goes to the dock", async ({
  page,
}) => {
  await mockApi(page);
  await launchApp(page);
  const dock = page.getByRole("textbox", { name: /ask mantua/i });
  await dock.fill("what should I watch");
  await dock.press("Enter");
  await page.getByRole("button", { name: "New chat" }).click();

  await expect(page.getByText("Start Trading With Your First Six Prompts")).toBeVisible();
  const cards = page.getByTestId("starter-prompt");
  await expect(cards).toHaveCount(6);
  await expect(cards.nth(0)).toContainText("Prompt 1 · Find the games that matter");
  await expect(cards.nth(4)).toContainText("Prompt 5 · Execute and manage it");
  await expect(cards.nth(5)).toContainText("Prompt 6 · Find the probability gaps");
  await page.screenshot({ path: "test-results/starter-prompts.png" });

  // Prompt 2 names a game the user must choose: it lands in the dock, unsent.
  await cards.nth(1).click();
  await expect(dock).toHaveValue(/Take a deeper look at \[GAME\]\./);
  await expect(cards).toHaveCount(6);

  // Prompt 1 is complete: it sends and starts the thread.
  await cards.nth(0).click();
  await expect(
    page.getByText("What sports markets should I be watching today?").first(),
  ).toBeVisible();
  await expect(cards).toHaveCount(0);
});
