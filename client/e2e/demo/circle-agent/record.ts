/**
 * Records the Circle Sports Agent demo as one continuous take of the real
 * client: the board, the agent panel, the Daily Brief chip, the typed
 * instruction, the preview and the Confirm press.
 *
 *   npx tsx e2e/demo/circle-agent/record.ts   # needs the shimmed Vite server on 5173
 *
 * Every API answer is the e2e mock except the agent stream, served here
 * over a local SSE server (frame by frame, with the authored pauses).
 * Output: out/take.webm and out/take.json (the cut points, in ms).
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE` reuses a preinstalled Chromium.
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Locator, type Page } from "@playwright/test";
import { mockApi, signIn } from "../../harness.ts";
import { AGENT_PORTFOLIO } from "./data.ts";
import { TURNS } from "./turns.ts";

const OUT = new URL("./out/", import.meta.url).pathname;
const SIZE = { width: 1280, height: 720 };
/** Zoomed so the UI reads like a product shot: the layout sees 960 px. */
const ZOOM = "html { zoom: 1.3333; } * { caret-color: transparent !important; }";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const streamMs = (i: number) => TURNS.at(i)?.frames.reduce((n, f) => n + f.wait, 0) ?? 0;

/** The SSE server on the port Vite proxies `/api` to; turn n answers request n. */
function sseServer(): Promise<() => void> {
  let n = 0;
  const server = createServer((_req, res) => {
    const turn = TURNS.at(n);
    n += 1;
    void (async () => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      for (const f of turn?.frames ?? []) {
        await sleep(f.wait);
        res.write(`data: ${JSON.stringify(f.event)}\n\n`);
      }
      res.end();
    })();
  });
  return new Promise((resolve) => {
    server.listen(3001, "127.0.0.1", () => {
      resolve(() => server.close());
    });
  });
}

/** A visible pointer: the real page has none in a headless recording. */
const CURSOR = `(() => {
  const c = document.createElement("div");
  c.id = "__demo-cursor";
  c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:18px;height:26px;opacity:0;transition:opacity .2s";
  c.innerHTML = '<svg viewBox="0 0 22 30" width="18" height="26"><path d="M2 2 L2 23 L7.5 18 L11 27 L15 25.5 L11.5 17 L19 17 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.addEventListener("DOMContentLoaded", () => document.body.append(c));
  window.addEventListener("mousemove", (e) => { c.style.opacity = "1"; c.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)"; });
  window.addEventListener("mousedown", () => { c.style.filter = "brightness(.6)"; });
  window.addEventListener("mouseup", () => { c.style.filter = ""; });
})();`;

/** Glide the pointer to `target` and press it. */
async function press(page: Page, target: Locator): Promise<void> {
  await target.waitFor();
  await target.scrollIntoViewIfNeeded();
  await sleep(400);
  const box = await target.boundingBox();
  if (!box) throw new Error("target has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
  await sleep(350);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}

async function record(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const close = await sseServer();
  const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: SIZE },
    colorScheme: "dark",
    timezoneId: "America/New_York",
  });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  const marks: Record<string, number> = {};

  await mockApi(page, { termsAccepted: true });
  await page.route("**/api/agent/portfolio**", (route) => route.fulfill({ json: AGENT_PORTFOLIO }));
  await page.route("**/api/agent/chat", (route) => route.continue());
  await page.goto("http://localhost:5173/");
  await signIn(page);
  await page.addStyleTag({ content: ZOOM });
  await page.mouse.move(640, 600);

  // The board, then into the agent.
  const entry = page.getByText("Create / Manage Sports Agent").first();
  await entry.waitFor();
  marks["home"] = at();
  await sleep(1800);
  await press(page, entry);
  const chip = page.getByRole("button", { name: "Daily Brief", exact: true }).first();
  await chip.waitFor();
  marks["agent"] = at();
  await sleep(1600);

  // Turn 1 — the Daily Brief chip.
  await press(page, chip);
  marks["brief"] = at();
  await sleep(streamMs(0) + 2200);

  // Turn 2 — the instruction, typed into the dock.
  const dock = page.getByRole("textbox", { name: /ask mantua/i });
  await press(page, dock);
  marks["plan"] = at();
  await dock.pressSequentially(TURNS.at(1)?.prompt ?? "", { delay: 36 });
  await sleep(600);
  await dock.press("Enter");
  await sleep(streamMs(1) + 1800);

  // Turn 3 — the preview's Confirm trade button.
  await press(page, page.getByRole("button", { name: "Confirm trade" }));
  marks["confirm"] = at();
  await sleep(streamMs(2) + 3200);
  marks["end"] = at();

  const video = page.video();
  await page.close();
  if (video) await video.saveAs(`${OUT}take.webm`);
  writeFileSync(`${OUT}take.json`, JSON.stringify(marks));
  await context.close();
  await browser.close();
  close();
  console.log("recorded take", JSON.stringify(marks));
}

await record();
