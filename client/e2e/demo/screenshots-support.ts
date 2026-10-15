/**
 * Helpers for the showcase screenshots (screenshots.ts): a JSON route
 * answer, a sleep, and the local SSE server that plays an authored agent
 * turn frame by frame on the port Vite proxies `/api` to.
 */
import { createServer } from "node:http";
import type { Route } from "@playwright/test";
import type { Frame } from "./turns.ts";

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const json = (route: Route, body: unknown): Promise<void> =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

export function agentStreamServer(frames: () => Frame[]): Promise<{ close: () => void }> {
  const server = createServer((_req, res) => {
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
      resolve({ close: () => server.close() });
    });
  });
}
