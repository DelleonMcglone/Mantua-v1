/**
 * Task 067 (G-008) — credential patterns for the repository secret scan.
 * Pure: the test beside it walks the tree; this file only knows what a
 * committed secret looks like.
 */

export interface SecretPattern {
  name: string;
  re: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "stripe-live-key", re: /\bsk_live_[A-Za-z0-9]{8,}/ },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  {
    name: "secret-assignment-hex",
    // A secret-named variable assigned a literal 32+ byte hex value.
    re: /\b[A-Z0-9_]*(PRIVATE_KEY|SECRET|API_KEY|ENTITY_SECRET)\b\s*[:=]\s*["']?(0x)?[0-9a-fA-F]{64}\b/,
  },
];

/**
 * Public, well-known values that are not credentials: the default Anvil /
 * Hardhat account keys used by local tooling and docs.
 */
export const ALLOWLIST: readonly RegExp[] = [
  /0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80/,
  /0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d/,
];

export interface SecretHit {
  line: number;
  pattern: string;
}

/** Scan a text; one hit per (line, pattern), allowlisted values skipped. */
export function scanText(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOWLIST.some((a) => a.test(line))) continue;
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(line)) hits.push({ line: i + 1, pattern: p.name });
    }
  }
  return hits;
}
