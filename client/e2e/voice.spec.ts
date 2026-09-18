import { expect, test, type Page } from "@playwright/test";
import { launchApp, mockApi, signIn } from "./harness.ts";

/**
 * Task 069 (V-011) — voice in a real browser. The microphone and the
 * transcription socket are scripted (e2e/voice-transport-shim.ts); every
 * other part of the path is the real one, which is the point: a spoken
 * command has to land where a typed command lands, and a spoken word must
 * not be able to execute a trade.
 */

/** Holds the button, speaks, and releases — one push-to-talk press. */
async function speak(page: Page, said: string, opts: { partial?: string } = {}): Promise<void> {
  const mic = page.getByTestId("mic");
  await mic.hover();
  await page.mouse.down();
  await expect(mic).toHaveAttribute("data-phase", "listening");

  if (opts.partial !== undefined) {
    await page.evaluate((text) => {
      window.__mantuaVoice?.partial(text);
    }, opts.partial);
    await expect(page.getByTestId("command-input")).toHaveValue(opts.partial);
  }

  await page.evaluate((text) => {
    window.__mantuaVoice?.commit(text);
  }, said);
  // Clear the mis-press threshold (activation-core MIN_PRESS_MS).
  await page.waitForTimeout(400);
  await page.mouse.up();
}

test("a spoken request lands exactly where the typed one does, with the words shown as they arrive", async ({
  page,
}) => {
  await mockApi(page);
  await launchApp(page);

  // V-003: the provisional guess is on screen while the user is still talking.
  await speak(page, "What can I trade this week?", { partial: "What can I trade" });

  // V-004 / V-005: the same parse, the same route as discover.spec.ts's typed case.
  await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible();
  await expect(page.getByTestId("discover-title")).toHaveText("Open now · this week");
  await expect(page.getByTestId("discover-row")).toHaveCount(1);
});

test("a spoken market request reaches the research the analyst wrote", async ({ page }) => {
  await mockApi(page);
  await launchApp(page);

  await speak(page, "Show me the NFL markets");
  await expect(page.getByRole("heading", { name: "NFL" })).toBeVisible();
  await page.getByTestId("game-row").first().click();
  await expect(
    page.getByRole("heading", { name: "Kansas City Chiefs at Las Vegas Raiders" }),
  ).toBeVisible();

  // V-005: research is one of the four command families, and it is the
  // Phase 11 section rendering — reached from a spoken request.
  await page.getByTestId("toggle-research").click();
  const research = page.getByTestId("market-research");
  await expect(research).toBeVisible();
  await expect(research.getByTestId("research-action")).not.toBeEmpty();
});

test("a voice-driven trade executes only after the Confirm press", async ({ page }) => {
  const { state } = await mockApi(page, { termsAccepted: true });
  await launchApp(page);
  await signIn(page);

  await speak(page, "Show me the NFL markets");
  await expect(page.getByRole("heading", { name: "NFL" })).toBeVisible();

  await page.getByRole("button", { name: "Trade Kansas City Chiefs", exact: true }).click();
  const ticket = page.getByTestId("trade-ticket");
  await ticket.locator("[data-preset='100']").click();

  // V-009: saying the word does not confirm. The user is told so, the
  // ticket stays where it was, and nothing has been filled.
  await speak(page, "confirm");
  await expect(page.getByTestId("voice-notice")).toContainText("press Confirm");
  await expect(ticket).toBeVisible();
  expect(state.fills).toBe(0);

  // The press is what executes it.
  await page.getByTestId("confirm").click();
  const executed = page.getByTestId("trade-executed");
  await expect(executed).toBeVisible({ timeout: 20_000 });
  await expect(executed).toContainText("Trade executed");
  await expect.poll(() => state.fills).toBeGreaterThan(0);
});

test("a mis-press submits nothing and says nothing; a silent press offers the retry", async ({
  page,
}) => {
  await mockApi(page);
  await launchApp(page);
  const mic = page.getByTestId("mic");

  // V-007: too brief to hold a word. Treated as the slip it is.
  await mic.hover();
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId("voice-notice")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Markets" })).toHaveCount(0);

  // V-007 / V-010: a real press that heard nothing earns one plain line.
  await mic.hover();
  await page.mouse.down();
  await expect(mic).toHaveAttribute("data-phase", "listening");
  await page.waitForTimeout(400);
  await page.mouse.up();
  await expect(page.getByTestId("voice-notice")).toContainText("I didn't catch that");

  // V-010: the keyboard never stopped working.
  const dock = page.getByTestId("command-input");
  await dock.fill("What can I trade this week?");
  await dock.press("Enter");
  await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible();
});

test("a failing microphone falls back to typing and stops offering itself", async ({ page }) => {
  await mockApi(page);
  await launchApp(page);

  const mic = page.getByTestId("mic");
  await mic.hover();
  await page.mouse.down();
  await expect(mic).toHaveAttribute("data-phase", "listening");
  await page.evaluate(() => {
    window.__mantuaVoice?.fail("permission_denied");
  });
  await page.mouse.up();

  await expect(page.getByTestId("voice-notice")).toContainText("still type");
  await expect(mic).toHaveAttribute("data-phase", "unavailable");
  await expect(mic).toBeDisabled();

  const dock = page.getByTestId("command-input");
  await dock.fill("What can I trade this week?");
  await dock.press("Enter");
  await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible();
});
