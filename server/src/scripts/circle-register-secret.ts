/**
 * Register a Circle entity secret — `npm run circle:register-secret -w @mantua/server`.
 *
 * YOU generate the secret and YOU run this; it is never generated for you.
 * The entity secret is full custody of every agent wallet, so it lives only
 * in your environment and your secrets manager.
 *
 * Flow:
 *   1. Generate a secret:  npm run circle:generate-secret -w @mantua/server
 *   2. Put it in server/.env as CIRCLE_ENTITY_SECRET (and CIRCLE_API_KEY).
 *   3. Run this script. It registers the ciphertext with Circle and writes
 *      the recovery file OUTSIDE the repo (~/.circle/ by default), because
 *      a recovery file committed to git is the same disclosure as the
 *      secret itself.
 *
 * Registration is NOT idempotent — re-registering rotates the secret and
 * invalidates the previous one, so this refuses to overwrite an existing
 * recovery file unless you pass --force.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as DCW from "@circle-fin/developer-controlled-wallets";

// CJS interop: named exports land on `default` under Node's ESM loader
// (a static named import fails to resolve). Same unwrap as circle/client.ts.
async function loadSdk(): Promise<typeof DCW> {
  const mod = await import("@circle-fin/developer-controlled-wallets");
  return (mod as { default?: typeof DCW }).default ?? mod;
}

const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

async function main(): Promise<number> {
  const apiKey = process.env["CIRCLE_API_KEY"];
  const entitySecret = process.env["CIRCLE_ENTITY_SECRET"];
  const force = process.argv.includes("--force");

  if (!apiKey || !entitySecret) {
    console.error(
      "Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in server/.env first.\n" +
        "Generate a secret with: npm run circle:generate-secret -w @mantua/server",
    );
    return 1;
  }
  if (!HEX_32_BYTES.test(entitySecret)) {
    console.error("CIRCLE_ENTITY_SECRET must be 64 hex characters (32 bytes).");
    return 1;
  }
  // Check the key's shape locally first. Circle rejects a malformed key with
  // a generic "malformed API key" message that doesn't say WHICH part is
  // wrong, so a local check with specific guidance saves a round trip and a
  // lot of guessing.
  if (!/^(TEST|LIVE)_API_KEY:[0-9a-f]{32}:[0-9a-f]{32}$/i.test(apiKey)) {
    const parts = apiKey.split(":");
    console.error(
      `CIRCLE_API_KEY is not the shape Circle accepts.\n\n` +
        `  expected:  LIVE_API_KEY:<32 hex>:<32 hex>   (3 parts, 2 colons)\n` +
        `  yours:     ${String(parts.length)} part(s), ${String(apiKey.length)} chars, ` +
        `starts with ${/^(TEST|LIVE)_API_KEY:/i.test(apiKey) ? "a valid prefix" : "no TEST_/LIVE_API_KEY prefix"}\n\n` +
        `The full key is shown ONCE, when you create it. The API Keys LIST page\n` +
        `shows only the key's ID — the secret half is not recoverable from it.\n` +
        `If you no longer have the original line, create a new key:\n` +
        `  https://console.circle.com  ->  API Keys  ->  Create key\n` +
        `and copy the single line it displays, whole and unmodified.\n`,
    );
    return 1;
  }
  if (/^TEST_API_KEY:/i.test(apiKey)) {
    console.warn("Note: this is a TEST key — registering against Circle's testnet entity.\n");
  }

  // Default outside the repo. Override with CIRCLE_RECOVERY_FILE_PATH.
  const outPath =
    process.env["CIRCLE_RECOVERY_FILE_PATH"] ??
    path.join(os.homedir(), ".circle", "mantua-recovery-file.dat");

  if (fs.existsSync(outPath) && !force) {
    console.error(
      `A recovery file already exists at ${outPath}.\n` +
        "Registration is NOT idempotent — re-running rotates the entity secret and\n" +
        "invalidates the current one, orphaning every wallet created under it.\n" +
        "If you are deliberately rotating, back up the existing file and pass --force.",
    );
    return 1;
  }

  console.log("Registering entity secret ciphertext with Circle…");
  const { registerEntitySecretCiphertext } = await loadSdk();
  const res = await registerEntitySecretCiphertext({ apiKey, entitySecret });
  const recoveryFile = res.data?.recoveryFile;
  if (!recoveryFile) {
    console.error("Circle returned no recovery file — registration did not complete.");
    return 1;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, recoveryFile, { mode: 0o600 });

  console.log(
    `\n✓ Registered. Recovery file written to ${outPath} (mode 600).\n\n` +
      "Now do these, in this order:\n" +
      "  1. Back up that recovery file somewhere durable and offline (password\n" +
      "     manager or secrets vault). Losing the entity secret without it means\n" +
      "     every agent wallet is permanently unrecoverable.\n" +
      "  2. Store CIRCLE_ENTITY_SECRET in your secrets manager / Vercel env too.\n" +
      "  3. Create the wallet set and Gas Station policy, then verify with:\n" +
      "     npm run circle:preflight -w @mantua/server\n",
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    // Never echo the secret; print only the failure reason.
    console.error(`Registration failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
