/**
 * Shot 1 — today's games: the signed-in home board with the day's NFL
 * slate (ET kickoffs, live scores and finals from the snapshot, the posted
 * lines, the Trade control), then a slow look down the list.
 */
import { closeShot, openShot, sleep } from "./browser.ts";
import type { DemoData } from "./mocks.ts";

export async function recordBoard(data: DemoData): Promise<void> {
  // Lighter zoom here: the board column only shows at a desktop width.
  const shot = await openShot(data, 1.12);
  const { page, t0 } = shot;
  await page
    .getByRole("button", { name: /^Analyze .+ at .+/ })
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(async () => {
      await page.screenshot({ path: new URL("./out/board-fail.png", import.meta.url).pathname });
      throw new Error("no matchup card on the board — see out/board-fail.png");
    });
  await sleep(600);
  const cutInMs = Date.now() - t0;
  await sleep(2200);
  for (let i = 0; i < 26; i += 1) {
    await page.mouse.wheel(0, 18);
    await sleep(100);
  }
  await sleep(1800);
  await closeShot(shot, "board", cutInMs);
}
