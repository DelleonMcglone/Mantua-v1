/**
 * Renders index.html to out/mantua-circle-agent-demo.mp4.
 *
 * Serves this folder over HTTP (module scripts need an origin), drives
 * `window.seek(t)` frame by frame in headless Chromium and pipes PNG
 * frames into ffmpeg. Deterministic: the same timeline renders the same
 * video every run.
 *
 *   node render.mjs            # full render
 *   node render.mjs --still 7  # one PNG at t=7s (out/still-7.png)
 *
 * Requires: node >= 20, ffmpeg on PATH, playwright (local or global).
 * Set MANTUA_DEMO_CHROMIUM to a Chromium binary to skip Playwright's own
 * browser download (e.g. a preinstalled /opt/pw-browsers/chromium).
 */
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { FPS, WIDTH, HEIGHT, DURATION } from "./js/timeline.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "out");
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
};

const require = createRequire(import.meta.url);
const { chromium } = require(
  require.resolve("playwright", {
    paths: [
      ROOT,
      process.cwd(),
      join(process.execPath, "../../lib/node_modules"),
      "/opt/node-tools/node_modules",
    ],
  }),
);

/** Static server for the demo folder; resolves with its port. */
function serve() {
  const server = createServer(async (req, res) => {
    const path = join(ROOT, decodeURIComponent((req.url ?? "/").split("?")[0]));
    const file = path.endsWith("/") ? join(path, "index.html") : path;
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })),
  );
}

async function openPage(port) {
  const executablePath = process.env.MANTUA_DEMO_CHROMIUM || undefined;
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.addInitScript(() => {
    window.__driven = true;
  });
  await page.goto(`http://127.0.0.1:${String(port)}/index.html`);
  await page.waitForFunction(() => window.__ready === true);
  return { browser, page };
}

async function still(page, t) {
  await page.evaluate((s) => window.seek(s), t);
  const file = join(OUT, `still-${String(t)}.png`);
  await page.screenshot({ path: file, type: "png" });
  console.log(`wrote ${file}`);
}

async function video(page) {
  const file = join(OUT, "mantua-circle-agent-demo.mp4");
  const frames = Math.round(DURATION * FPS);
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      String(FPS),
      "-c:v",
      "png",
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "slow",
      "-crf",
      "18",
      "-movflags",
      "+faststart",
      file,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate((s) => window.seek(s), i / FPS);
    const png = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % FPS === 0) process.stdout.write(`\r${String(i / FPS)}s / ${String(DURATION)}s`);
  }
  ff.stdin.end();
  await new Promise((resolve, reject) =>
    ff.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${String(code)}`)),
    ),
  );
  console.log(`\nwrote ${file} (${String(frames)} frames)`);
}

const stillAt = process.argv.indexOf("--still");
await mkdir(OUT, { recursive: true });
const { server, port } = await serve();
const { browser, page } = await openPage(port);
try {
  if (stillAt >= 0) await still(page, Number(process.argv[stillAt + 1]));
  else await video(page);
} finally {
  await browser.close();
  server.close();
}
