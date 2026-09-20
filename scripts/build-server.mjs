// Builds the Vercel serverless function's server bundle.
//
// Two esbuild passes:
//   1. api/_dcw.mjs — the Circle Developer-Controlled-Wallets SDK and its sole
//      dep (axios) bundled into one self-contained ESM file. The SDK lives in
//      server/node_modules (un-hoisted) and a bare dynamic import of it isn't
//      followed by Vercel's file tracer, so we inline it instead of shipping it
//      as a node_module.
//   2. api/_server.mjs — the Express app, with the heavy/native deps
//      (express, pg, pino, viem, …) kept external (tsx/Vercel resolve them from
//      the ROOT node_modules; bundling pino/pg breaks on their dynamic
//      requires) — but only the packages actually hoisted to the root are
//      external; an un-hoisted workspace dep is bundled (see rootPackages) — and
//      @circle-fin aliased to the self-contained bundle from pass 1 so it gets
//      inlined here. The result needs no @circle-fin/axios at runtime.
//
// Only pass 1 gets a createRequire banner: bundling the SDK+axios CJS into ESM
// turns their `require("util")`/etc. (Node built-ins) into esbuild's __require
// shim, which throws "Dynamic require of X is not supported" unless a real
// `require` is in scope. The banner provides one via import.meta.url. Pass 2 is
// pure ESM (its only CJS — the SDK — is inlined from pass 1 and carries that
// banner with it), so adding the banner there too would re-declare __cr.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Packages the function may leave external: exactly the ones installed in
 * the ROOT node_modules, which is where Vercel's file tracer (and Node at
 * runtime) resolves a bare import from `api/`. A workspace dependency npm
 * did not hoist — it lives in `server/node_modules` (express-rate-limit
 * today) — is invisible there and would fail the function at boot with
 * "Cannot find package", so anything not on this list is bundled instead.
 */
function rootPackages() {
  const dir = join(root, "node_modules");
  const names = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(join(dir, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory()) names.push(`${entry.name}/${scoped.name}`);
      }
    } else {
      names.push(entry.name);
    }
  }
  return names;
}
const banner = {
  js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
};

const dcwOut = join(root, "api/_dcw.mjs");
const ubkOut = join(root, "api/_ubk.mjs");

await build({
  entryPoints: [join(root, "server/dcw-entry.mjs")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: dcwOut,
  banner,
});

// Unified Balance Kit + Circle Wallets adapter, bundled self-contained. Same
// rationale as _dcw.mjs (the tracer won't follow the bare import) plus bundling
// resolves the adapter's CJS `Blockchain` named import from
// developer-controlled-wallets, which Node's ESM loader can't see at runtime.
await build({
  entryPoints: [join(root, "server/ubk-entry.mjs")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ubkOut,
  banner,
});

// The aliased Circle packages are bundled from the passes above, so they
// must not be external even though some are hoisted to the root.
const ALWAYS_BUNDLE = new Set([
  "@circle-fin/developer-controlled-wallets",
  "@circle-fin/smart-contract-platform",
  "@circle-fin/unified-balance-kit",
  "@circle-fin/adapter-circle-wallets",
  "@circle-fin/bridge-kit",
  "@circle-fin/adapter-viem-v2",
]);
const external = rootPackages()
  .filter((name) => !ALWAYS_BUNDLE.has(name))
  .flatMap((name) => [name, `${name}/*`]);

await build({
  entryPoints: [join(root, "server/src/app.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  external,
  alias: {
    "@circle-fin/developer-controlled-wallets": dcwOut,
    "@circle-fin/smart-contract-platform": dcwOut,
    "@circle-fin/unified-balance-kit": ubkOut,
    "@circle-fin/adapter-circle-wallets": ubkOut,
    "@circle-fin/bridge-kit": ubkOut,
    "@circle-fin/adapter-viem-v2": ubkOut,
  },
  outfile: join(root, "api/_server.mjs"),
});

console.log("built api/_dcw.mjs + api/_ubk.mjs + api/_server.mjs");
