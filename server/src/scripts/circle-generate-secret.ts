/**
 * Generate a Circle entity secret — `npm run circle:generate-secret -w @mantua/server`.
 *
 * Prints a fresh 32-byte secret to YOUR terminal and nowhere else. It is not
 * written to disk, not logged, and not sent anywhere: copy it straight into
 * `server/.env` as `CIRCLE_ENTITY_SECRET`, then register it with
 * `npm run circle:register-secret -w @mantua/server`.
 *
 * The SDK's `generateEntitySecret()` returns `void` — it console.logs the
 * value itself, so there is nothing here to capture or accidentally persist.
 */
import type * as DCW from "@circle-fin/developer-controlled-wallets";

// The SDK is CJS; under Node's ESM loader its named exports land on
// `default`, so a static `import { generateEntitySecret }` fails to resolve.
// Load dynamically and unwrap, same as lib/circle/client.ts.
async function loadSdk(): Promise<typeof DCW> {
  const mod = await import("@circle-fin/developer-controlled-wallets");
  return (mod as { default?: typeof DCW }).default ?? mod;
}

const sdk = await loadSdk();

console.log("\nYour new entity secret (copy it into server/.env, then close this terminal):\n");
sdk.generateEntitySecret();
console.log(
  "\nNext:\n" +
    "  1. CIRCLE_ENTITY_SECRET=<the value above>   (server/.env — gitignored)\n" +
    "  2. npm run circle:register-secret -w @mantua/server\n\n" +
    "This value is full custody of every agent wallet. Store it in a secrets\n" +
    "manager; never commit it, paste it into a chat, or send it anywhere.\n",
);
