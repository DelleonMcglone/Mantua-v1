/**
 * The demo's browser: one recorded Chromium page per shot, as a US-East
 * viewer on the demo day (timezone and clock pinned), with every API
 * answer scripted (the e2e harness plus the demo's own routes) and the two
 * chat streams replayed frame by frame from a local SSE server so the
 * words arrive the way a model's do.
 */
import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mockApi, signIn } from "../harness.ts";
import { demoNowMs } from "./clock.ts";
import { installDemoRoutes, type DemoData } from "./mocks.ts";
import { demoEvents, demoSlate } from "./slate.ts";
import type { Turn } from "./turns.ts";

export const OUT = new URL("./out/", import.meta.url).pathname;
export const SIZE = { width: 1280, height: 720 };
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Today's data, resolved once per process: the snapshot or the fallback. */
export function demoData(): DemoData & { source: "snapshot" | "fallback" } {
  const events = demoEvents();
  const nowMs = demoNowMs(events);
  const { slate, source } = demoSlate(nowMs);
  return { slate, events, nowMs, source };
}

/** Streams the turn registered for each chat path with its authored pauses. */
export function sseServer(turns: Record<string, Turn>): Promise<{ close: () => void }> {
  const byPath = new Map(Object.entries(turns));
  const server: Server = createServer((req, res) => {
    const turn = byPath.get((req.url ?? "").split("?")[0] ?? "");
    if (!turn) {
      res.writeHead(404).end();
      return;
    }
    void (async () => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      for (const f of turn.frames) {
        await sleep(f.wait);
        res.write(`data: ${JSON.stringify(f.event)}\n\n`);
      }
      res.end();
    })();
  });
  return new Promise((resolve) => {
    // Vite proxies `/api` to :3001, so a request the page lets through lands here.
    server.listen(3001, "127.0.0.1", () => {
      resolve({ close: () => server.close() });
    });
  });
}

export interface Shot {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Recording start, for the cut-in point each shot reports. */
  t0: number;
}

/** A signed-in page on the home board, recording from its first frame. */
export async function openShot(
  data: DemoData,
  zoom: number,
  streams: string[] = [],
): Promise<Shot> {
  const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: SIZE },
    colorScheme: "dark",
    timezoneId: "America/New_York",
    locale: "en-US",
  });
  const page = await context.newPage();
  if (process.env["E2E_DEBUG"]) {
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) console.log(`[nav] ${f.url()}`);
    });
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning")
        console.log(`[page:${m.type()}] ${m.text()}`);
    });
    page.on("pageerror", (e) => {
      console.log(`[pageerror] ${e.message}`);
    });
    page.on("response", (r) => {
      if (r.status() >= 400)
        console.log(`[${String(r.status())}] ${r.request().method()} ${r.url()}`);
    });
  }
  await page.clock.setFixedTime(data.nowMs);
  const t0 = Date.now();
  await mockApi(page, { termsAccepted: true });
  await installDemoRoutes(page, data);
  for (const path of streams) await page.route(`**${path}`, (route) => route.continue());
  await page.goto("http://localhost:5173/");
  await signIn(page);
  await page.addStyleTag({
    content: `* { caret-color: transparent !important; } html { zoom: ${String(zoom)}; }`,
  });
  return { browser, context, page, t0 };
}

/** Save the clip and its cut-in point, then tear the browser down. */
export async function closeShot(shot: Shot, name: string, cutInMs: number): Promise<void> {
  const video = shot.page.video();
  await shot.page.close();
  if (video) {
    await video.saveAs(`${OUT}${name}.webm`);
    await video.delete();
  }
  writeFileSync(`${OUT}${name}.json`, JSON.stringify({ typingAtMs: cutInMs }));
  await shot.context.close();
  await shot.browser.close();
  console.log("recorded", name, `cut-in ${(cutInMs / 1000).toFixed(1)}s`);
}
