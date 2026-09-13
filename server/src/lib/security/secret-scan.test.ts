import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SECRET_PATTERNS, scanText } from "./secret-scan.ts";

/**
 * Task 067 (G-008) — no credential is committed. Walks every tracked
 * text file in the repository and runs the secret patterns; a match fails
 * the test with the file and the pattern. Public well-known values used by
 * test tooling are allowlisted in `secret-scan.ts`.
 */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "lib",
  "out",
  "cache",
]);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml|toml|sh|sol|env|example|txt|html|css)$/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.size < 2_000_000 && (TEXT.test(entry) || entry.startsWith(".env"))) yield full;
  }
}

void describe("secret scan (launch gate G-008)", () => {
  void it("the patterns catch real key shapes", () => {
    const hits = scanText(
      [
        "AWS_KEY=AKIAIOSFODNN7EXAMPLE",
        "-----BEGIN RSA PRIVATE KEY-----",
        "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
        "MARKET_SIGNER_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111112",
        "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      ].join("\n"),
    );
    assert.equal(hits.length, 5, JSON.stringify(hits));
  });

  void it("the patterns ignore empty assignments, computed keys, and hashes", () => {
    const hits = scanText(
      [
        "PRIVY_APP_SECRET=",
        'const key = "0x" + "11".repeat(32);',
        'txHash: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",',
        "PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      ].join("\n"),
    );
    assert.deepEqual(hits, []);
  });

  void it("no tracked file in the repository matches a secret pattern", () => {
    const offenders: string[] = [];
    for (const file of walk(REPO_ROOT)) {
      const text = readFileSync(file, "utf8");
      for (const hit of scanText(text)) {
        offenders.push(`${relative(REPO_ROOT, file)}:${String(hit.line)} ${hit.pattern}`);
      }
    }
    assert.deepEqual(offenders, [], offenders.join("\n"));
    assert.ok(SECRET_PATTERNS.length >= 6);
  });
});
