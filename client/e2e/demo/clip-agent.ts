/**
 * Shot 3 — create / manage the agent: the "Create / Manage Sports Agent"
 * card opens the agent chat, its "Create / Manage Agent" chip reports the
 * Circle wallet (address, daily cap, status); then Profile → Agent shows
 * the policy limits, and one hedging strategy is previewed and armed.
 */
import { closeShot, openShot, sleep, sseServer } from "./browser.ts";
import type { DemoData } from "./mocks.ts";
import { strategyTarget } from "./mocks-strategies.ts";
import { playTime } from "./turns.ts";
import { AGENT_WALLET_TURN } from "./turns-agent.ts";

export async function recordAgent(data: DemoData): Promise<void> {
  const sse = await sseServer({ "/api/agent/chat": AGENT_WALLET_TURN });
  const shot = await openShot(data, 1.12, ["/api/agent/chat"]);
  const { page, t0 } = shot;

  // Create: the chat, then the wallet card.
  await page.getByText("Create / Manage Sports Agent").first().click();
  const chip = page.getByRole("button", { name: "Create / Manage Agent" });
  await chip.waitFor();
  const cutInMs = Date.now() - t0;
  await sleep(900);
  await chip.click();
  await sleep(playTime(AGENT_WALLET_TURN) + 1800);

  // Manage: the policy panel under Profile → Agent.
  await page.getByRole("button", { name: /^0x/ }).first().click();
  await page.getByRole("menuitem", { name: "Profile & portfolio" }).click();
  await page.getByRole("tab", { name: /^Agent/ }).click();
  await page.getByText("Agent policy · your limits on the agent").waitFor();
  await sleep(2300);

  // Arm one hedging strategy from its preview.
  const heading = page.getByText("Hedging strategies");
  await heading.scrollIntoViewIfNeeded();
  await sleep(500);
  const input = page.getByPlaceholder(/take profit at 80%/);
  await input.click();
  await input.pressSequentially(strategyTarget(data.events).text, { delay: 32 });
  await sleep(300);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByText("Close at profit").waitFor();
  await sleep(1400);
  await page.getByRole("button", { name: "Confirm & arm" }).click();
  await page.getByText("armed", { exact: true }).first().waitFor();
  await sleep(2400);
  await closeShot(shot, "agent", cutInMs);
  sse.close();
}
