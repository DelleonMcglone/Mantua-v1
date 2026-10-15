/**
 * The three showcase screenshots: the board, a live market with its trade
 * ticket, and the agent thread. Same recipe as record.ts (the real client
 * on the shimmed dev server, every API answer scripted), rendered at
 * 1440×960 @2x for a forum post.
 *
 *   npx tsx e2e/demo/screenshots.ts        # needs the shimmed Vite server on 5173
 *
 * Output: docs/showcase/{1-board,2-market,3-agent}.png (repo root).
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { mockApi, signIn } from "../harness.ts";
import { TURN_6 } from "./turns.ts";
import { thisWeekSlate } from "./slate.ts";
import { agentStreamServer, json, sleep } from "./screenshots-support.ts";

const OUT = new URL("../../../docs/showcase/", import.meta.url).pathname;
const SIZE = { width: 1440, height: 960 };
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const STYLE = "* { caret-color: transparent !important; }";

async function open(): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 2,
    colorScheme: "dark",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();
  return { page, close: () => browser.close() };
}

/** 1 — the league page: the whole week's games, priced by the market. */
async function shootBoard(): Promise<void> {
  const { page, close } = await open();
  await mockApi(page, { termsAccepted: true });
  await page.route("**/api/sports/slate**", (route) => json(route, thisWeekSlate()));
  await page.goto("http://localhost:5173/");
  await signIn(page);
  await page.addStyleTag({ content: STYLE });
  await page
    .getByRole("button", { name: /view markets/i })
    .first()
    .click();
  // Weeks run Sunday to Saturday; the Sunday slate sits one step ahead.
  await page.getByRole("button", { name: "Next week" }).click();
  await page.getByText("Las Vegas Raiders").first().waitFor();
  await sleep(1500);
  await page.screenshot({ path: `${OUT}1-board.png` });
  await close();
  console.log("shot 1-board");
}

/** 2 — a live market: score, annotated chart, and a $100 ticket priced by the hook. */
async function shootMarket(): Promise<void> {
  const { page, close } = await open();
  await mockApi(page, { termsAccepted: true, liveGame: true });
  await page.goto("http://localhost:5173/");
  await signIn(page);
  await page.addStyleTag({ content: STYLE });
  await page.getByRole("button", { name: "NFL", exact: true }).first().click();
  await page.getByTestId("game-row").first().click();
  await page.getByRole("heading", { name: "Kansas City Chiefs at Las Vegas Raiders" }).waitFor();
  const ticket = page.getByTestId("trade-ticket");
  await ticket.getByRole("button", { name: "KC 50¢", exact: true }).click();
  await ticket.locator("[data-preset='100']").click();
  await page.getByTestId("fee-lines").waitFor();
  await page.getByTestId("confirm").waitFor();
  await sleep(1500);
  await page.screenshot({ path: `${OUT}2-market.png` });
  await close();
  console.log("shot 2-market");
}

/** 3 — the agent thread: one prompt, the tools it called, the gaps it found. */
async function shootAgent(): Promise<void> {
  const stream = await agentStreamServer(() => TURN_6.frames);
  const { page, close } = await open();
  await mockApi(page, { termsAccepted: true });
  await page.route("**/api/sports/slate**", (route) => json(route, thisWeekSlate()));
  await page.route("**/api/agent/portfolio**", (route) =>
    json(route, {
      address: "0x0eea000000000000000000000000000000009c03",
      balances: [{ symbol: "USDC", balanceRaw: "250000000", decimals: 6, usdValue: 250 }],
      transactions: [],
      positions: [],
    }),
  );
  await page.route("**/api/agent/chat", (route) => route.continue());
  await page.goto("http://localhost:5173/");
  await signIn(page);
  // Slightly zoomed out so the whole turn fits: header, thread and the dock.
  await page.addStyleTag({ content: `${STYLE} html { zoom: 0.92; }` });
  await page.getByText("Create / Manage Sports Agent").first().click();
  await page.getByText("Create / Manage Agent").first().waitFor();
  const dock = page.getByRole("textbox", { name: /ask mantua/i });
  await dock.fill(TURN_6.prompt);
  await dock.press("Enter");
  await sleep(TURN_6.frames.reduce((n, f) => n + f.wait, 0) + 2000);
  await page.evaluate(() => {
    window.scrollTo({ top: 0 });
  });
  await sleep(1000);
  await page.screenshot({ path: `${OUT}3-agent.png` });
  await close();
  stream.close();
  console.log("shot 3-agent");
}

mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
if (!only || only === "board") await shootBoard();
if (!only || only === "market") await shootMarket();
if (!only || only === "agent") await shootAgent();
