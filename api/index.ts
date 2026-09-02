import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Vercel serverless entrypoint. `vercel.json` rewrites /api/* here.
 *
 * The Express app is pre-bundled to plain JS at build time
 * (`npm run build:server` → `api/_server.mjs`, run from vercel.json's
 * buildCommand). We import THAT, never the `.ts` source — Vercel transpiles
 * `.ts` files but keeps their `.ts` import specifiers, which Node can't
 * resolve at runtime (`ERR_MODULE_NOT_FOUND …/server/src/app.ts`). The
 * esbuild bundle inlines the whole server tree into one `.mjs` with no
 * `.ts` imports.
 *
 * `_server.mjs` is underscore-prefixed so Vercel doesn't treat it as its own
 * route. The import is lazy + wrapped so a boot/config failure (e.g. env
 * validation throwing) returns readable JSON instead of an opaque 500.
 */
type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

let cached: NodeHandler | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!cached) {
      const mod = (await import("./_server.mjs")) as { app: unknown };
      cached = mod.app as NodeHandler;
    }
    await cached(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "server_boot_failed", message }));
  }
}
