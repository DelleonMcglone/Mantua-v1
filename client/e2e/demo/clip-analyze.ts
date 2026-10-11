/**
 * Shot 2 — the non-transactional prompt: the "Analyze today's NFL games"
 * card opens the analyst, the question is typed into the dock, and the
 * answer streams in with its source pills; it ends with no trade placed
 * and the panel's own "estimates, not a guarantee" note.
 */
import { closeShot, openShot, sleep, sseServer } from "./browser.ts";
import type { DemoData } from "./mocks.ts";
import { playTime } from "./turns.ts";
import { analyzeTurn } from "./turns-analyze.ts";

export async function recordAnalyze(data: DemoData): Promise<void> {
  const turn = analyzeTurn(data.events);
  const sse = await sseServer({ "/api/analyze/chat": turn });
  // Zoomed so the thread reads like a product shot: the layout sees ~1070 px.
  const shot = await openShot(data, 1.2, ["/api/analyze/chat"]);
  const { page, t0 } = shot;
  await page.getByText("Analyze today's NFL games, matchups, and markets").first().click();
  await page.getByTestId("starter-prompt").first().waitFor();
  await sleep(900);

  const dock = page.getByRole("textbox", { name: /ask mantua/i });
  await dock.click();
  const cutInMs = Date.now() - t0;
  await dock.pressSequentially(turn.prompt, { delay: 34 });
  await sleep(500);
  await dock.press("Enter");

  // Let the whole stream play, then hold the finished answer on screen.
  await sleep(playTime(turn) + 2000);
  await page.evaluate(() => {
    document.querySelector("main")?.scrollTo({ top: 1e6, behavior: "smooth" });
  });
  await sleep(2200);
  await closeShot(shot, "analyze", cutInMs);
  sse.close();
}
