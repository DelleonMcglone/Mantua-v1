import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { mockMobileApi } from "./fixtures-mobile.ts";
import {
  CRITICAL_JS_GZIP_MAX_BYTES,
  LARGEST_CHUNK_GZIP_MAX_BYTES,
} from "../../src/lib/mobile-budgets.ts";

/**
 * MX-006 — bytes on the wire. The critical path is whatever script the
 * first market view actually requests (observed in the browser, not
 * guessed from the manifest), each measured gzipped from `dist/`.
 */
test("the JavaScript the first market view downloads stays inside the byte budget", async ({
  page,
}) => {
  await mockMobileApi(page);
  const requested = new Set<string>();
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/assets/") && url.pathname.endsWith(".js")) {
      requested.add(url.pathname.replace("/assets/", ""));
    }
  });
  await page.goto("/?open=discover");
  await page.getByTestId("discover-row").first().waitFor({ state: "visible" });

  const dir = join(import.meta.dirname, "..", "..", "dist", "assets");
  const onDisk = new Set(readdirSync(dir));
  const sizes = [...requested]
    .filter((f) => onDisk.has(f))
    .map((f) => ({ file: f, gzip: gzipSync(readFileSync(join(dir, f))).length }));
  expect(sizes.length).toBeGreaterThan(0);
  const total = sizes.reduce((n, s) => n + s.gzip, 0);
  const largest = Math.max(...sizes.map((s) => s.gzip));
  test.info().annotations.push({
    type: "critical-js-gzip",
    description: `${String(total)} bytes across ${String(sizes.length)} chunks: ${sizes
      .map((s) => `${s.file}=${String(s.gzip)}`)
      .join(", ")}`,
  });
  console.log(
    `[mobile-budget] critical JS gzip ${String(total)} B in ${String(sizes.length)} chunks; largest ${String(largest)} B — ${sizes
      .map((s) => `${s.file}=${String(s.gzip)}`)
      .join(", ")}`,
  );
  // The deferred libraries must not be on the critical path.
  for (const deferred of ["bridge-vendor", "solana-vendor", "charts-vendor", "funding-vendor"]) {
    expect(
      sizes.some((s) => s.file.startsWith(deferred)),
      deferred,
    ).toBe(false);
  }
  expect(total, `critical JS ${String(total)} B gzip`).toBeLessThan(CRITICAL_JS_GZIP_MAX_BYTES);
  expect(largest, `largest chunk ${String(largest)} B gzip`).toBeLessThan(
    LARGEST_CHUNK_GZIP_MAX_BYTES,
  );
});
