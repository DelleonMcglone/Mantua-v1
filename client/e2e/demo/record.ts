/**
 * Records the three agent turns of the landing-page demo as webm clips.
 *
 *   npx tsx e2e/demo/record.ts          # needs the shimmed Vite server on 5173
 *
 * The app is the real client; every API answer is the e2e mock except the
 * agent stream, which this script serves itself over a local SSE server
 * (frame by frame, with the authored pauses) so the words arrive the way a
 * model's do. Output: e2e/demo/out/turn-{1,2,6}.webm.
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { mockApi, signIn } from "../harness.ts";
import { TURN_1, TURN_2, TURN_6, type Frame } from "./turns.ts";
import { week5Slate } from "./slate.ts";

const OUT = new URL("./out/", import.meta.url).pathname;
const SIZE = { width: 1280, height: 720 };
/** Zoomed 4:3 so the UI reads larger, like a product shot: the layout
 *  sees 960 px, which puts the agent thread across the whole frame. */
const ZOOM = "html { zoom: 1.3333; }";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The SSE server on the API port Vite proxies `/api` to; the page's route
 *  handler lets the chat request through so the frames stream for real. */
function sseServer(frames: () => Frame[]): Promise<{ port: number; close: () => void }> {
  const server = createServer((req, res) => {
    void req;
    void (async () => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      for (const f of frames()) {
        await sleep(f.wait);
        res.write(`data: ${JSON.stringify(f.event)}\n\n`);
      }
      res.end();
    })();
  });
  return new Promise((resolve) => {
    server.listen(3001, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

async function record(name: string, turn: { prompt: string; frames: Frame[] }) {
  const sse = await sseServer(() => turn.frames);
  void sse.port;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: SIZE },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const t0 = Date.now();
  await mockApi(page, { termsAccepted: true });
  await page.route("**/api/sports/slate**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(week5Slate()),
    }),
  );
  await page.route("**/api/agent/portfolio**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        address: "0x0eea000000000000000000000000000000009c03",
        balances: [{ symbol: "USDC", balanceRaw: "250000000", decimals: 6, usdValue: 250 }],
        transactions: [],
        positions: [],
      }),
    }),
  );
  await page.route("**/api/agent/chat", (route) => route.continue());
  await page.goto("http://localhost:5173/");
  await signIn(page);
  await page.addStyleTag({ content: `* { caret-color: transparent !important; } ${ZOOM}` });
  await page.getByText("Create / Manage Sports Agent").first().click();
  await page.getByText("Create / Manage Agent").first().waitFor();
  await sleep(1200);

  const dock = page.getByRole("textbox", { name: /ask mantua/i });
  await dock.click();
  // Where the typing starts, relative to the recording: the cut-in point.
  const typingAtMs = Date.now() - t0;
  await dock.pressSequentially(turn.prompt, { delay: 38 });
  await sleep(700);
  await dock.press("Enter");

  // Let the whole stream play, then hold the finished turn on screen.
  const total = turn.frames.reduce((n, f) => n + f.wait, 0) + 2500;
  await sleep(total);
  await page.evaluate(() => {
    document.querySelector("[data-testid='agent-thread'], main")?.scrollTo({ top: 1e6 });
  });
  await sleep(2500);

  const video = page.video();
  await page.close();
  if (video) await video.saveAs(`${OUT}${name}.webm`);
  writeFileSync(`${OUT}${name}.json`, JSON.stringify({ typingAtMs }));
  await context.close();
  await browser.close();
  sse.close();
  console.log("recorded", name);
}

/** The board shot: the home page with this week's games, a slow look down the list. */
async function recordBoard() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: SIZE },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const t0 = Date.now();
  await mockApi(page, { termsAccepted: true });
  await page.route("**/api/sports/slate**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(week5Slate()),
    }),
  );
  await page.goto("http://localhost:5173/");
  await signIn(page);
  // Lighter zoom here: the board column only shows at a desktop width.
  await page.addStyleTag({
    content: "* { caret-color: transparent !important; } html { zoom: 1.12; }",
  });
  await page.getByRole("button", { name: "Trade", exact: true }).first().waitFor();
  await sleep(600);
  const typingAtMs = Date.now() - t0;
  await sleep(2000);
  // Into the NFL page: the whole week's games, then a slow look down the list.
  await page
    .getByRole("button", { name: /view markets/i })
    .first()
    .click();
  await page.getByRole("button", { name: "Next week" }).waitFor();
  await sleep(900);
  await page.getByRole("button", { name: "Next week" }).click();
  await page
    .getByText("Las Vegas Raiders")
    .first()
    .waitFor({ timeout: 8000 })
    .catch(async () => {
      await page.screenshot({ path: `${OUT}board-fail.png` });
      throw new Error("week 5 not on the page — see out/board-fail.png");
    });
  await sleep(1800);
  for (let i = 0; i < 28; i += 1) {
    await page.mouse.wheel(0, 16);
    await sleep(100);
  }
  await sleep(1800);
  const video = page.video();
  await page.close();
  if (video) await video.saveAs(`${OUT}board.webm`);
  writeFileSync(`${OUT}board.json`, JSON.stringify({ typingAtMs }));
  await context.close();
  await browser.close();
  console.log("recorded board");
}

const only = process.argv[2];
if (!only || only === "board") await recordBoard();
if (!only || only === "1") await record("turn-1", TURN_1);
if (!only || only === "2") await record("turn-2", TURN_2);
if (!only || only === "6") await record("turn-6", TURN_6);
