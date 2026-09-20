import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * T-004 / T-005 / T-020 — the consumer layer never speaks chain. This
 * sweeps every user-facing string in the market surfaces (the league page,
 * the ticket, the market page, discovery, the shell chips) for gas / ETH /
 * network / chain / explorer vocabulary and raw addresses. Comments and
 * import lines are stripped first: the rule is about what a user reads.
 */
const ROOTS = [
  join(import.meta.dirname, "."),
  join(import.meta.dirname, "..", "..", "components", "shell", "QuickActions.tsx"),
  join(import.meta.dirname, "..", "..", "components", "shell", "HomeMenu.tsx"),
  join(import.meta.dirname, "..", "..", "components", "shell", "InputBar.tsx"),
  // Task 075 — the home page's footer (moved off the deleted landing page).
  join(import.meta.dirname, "..", "..", "components", "shell", "Footer.tsx"),
];

const FORBIDDEN = [
  /\bgas\b/i,
  /\bETH\b/,
  /\bon-?chain\b/i,
  /\bblockchain\b/i,
  /\bnetwork\b/i,
  /\bmainnet\b/i,
  /\bexplorer\b/i,
  /\b(base|arbitrum|optimism|polygon) (chain|network)\b/i,
  /["'`>]\s*0x[0-9a-fA-F]{6,}/,
];

function* walk(path: string): Generator<string> {
  if (statSync(path).isFile()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry) && !/\.test\.ts$/.test(entry)) yield full;
  }
}

/** Keep only what can reach the screen: strip comments and import lines. */
function userFacing(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^import .*$/gm, "");
}

test("consumer market surfaces carry no chain vocabulary or addresses (T-004/T-005/T-020)", () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const text = userFacing(readFileSync(file, "utf8"));
      for (const re of FORBIDDEN) {
        const m = re.exec(text);
        if (m) offenders.push(`${file.replace(import.meta.dirname, "markets")}: "${m[0]}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
