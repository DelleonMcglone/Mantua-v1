import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Phase 9 / PF-018 — the consumer UI never names a chain or an explorer.
 * The rule (docs/tasks/prediction-market-protocol.md P-010; task 046): a
 * verification link is rendered through the neutral tx row ("Explorer"),
 * and no consumer surface says BaseScan / Etherscan / "on Base".
 *
 * This sweep scans the consumer feature and shell sources (comments
 * stripped — they are not UI) for branded strings. Two carve-outs are
 * deliberate and listed below; anything else is a failure with the file.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const SCAN_DIRS = ["features", "components/shell", "components/ui"];
const ALLOWLIST = new Set([
  // The deposit surface names the network the user must send on (sanctioned carve-out, DepositCard).
  "features/portfolio/DepositCard.tsx",
]);
const BRANDED =
  /basescan\.org|\bBaseScan\b|\bEtherscan\b|etherscan\.io|\bon Base\b|Base Sepolia|Base Mainnet/i;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

void describe("PF-018 — no chain branding in consumer surfaces", () => {
  void it("finds no BaseScan / Etherscan / 'on Base' outside the two carve-outs", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (ALLOWLIST.has(rel)) continue;
        const body = stripComments(readFileSync(file, "utf8"));
        const m = BRANDED.exec(body);
        if (m) offenders.push(`${rel}: "${m[0]}"`);
      }
    }
    assert.deepEqual(offenders, [], `branded strings in consumer UI:\n${offenders.join("\n")}`);
  });
});
