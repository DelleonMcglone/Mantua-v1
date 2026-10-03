/**
 * C-014 — chain-identifier smoke test. `npm run circle:id-smoke -w @mantua/server`.
 *
 * Chain identifiers are stringly-typed at every Circle boundary the app
 * crosses, and each SDK family spells them differently:
 *
 *   - Developer-Controlled Wallets use SCREAMING ids ("ARC", "ARC-TESTNET")
 *
 * A silent rename in an SDK upgrade would not fail typecheck where the app
 * passes plain strings, so this script re-validates every identifier the app
 * assumes against the INSTALLED SDKs in node_modules.
 *
 * Two layers:
 *
 *   OFFLINE (always runs, no credentials, no network):
 *     - the DCW `Blockchain` union contains "ARC" and "ARC-TESTNET"
 *       (compile time), and the id the app persists/sends
 *       (agent-wallet-create.ts) is that literal
 *     The app-side ids are extracted from the SOURCE FILES, not duplicated
 *     here, so this cannot drift from what the code actually sends.
 *
 *   LIVE (only when CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET are set):
 *     - one listWallets call asserting an ARC-family blockchain value
 *       round-trips through the real API.
 *
 * Exit 0 = every identifier found (live layer passed or was skipped).
 * Exit 1 = any identifier missing, or the live layer failed.
 *
 * No secret material is ever printed — key shapes only, matching
 * circle-preflight.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Blockchain as DcwBlockchain } from "@circle-fin/developer-controlled-wallets";

// ── Compile-time assertions ─────────────────────────────────────────────────
// If an SDK upgrade drops an Arc id from a `Blockchain` union, `npm run
// typecheck` fails on these lines before the script even runs.
const DCW_ARC_ID: DcwBlockchain = "ARC";
const DCW_ARC_TESTNET_ID: DcwBlockchain = "ARC-TESTNET";

const ok = (m: string) => {
  console.log(`  ✓ ${m}`);
};
const bad = (m: string) => {
  console.log(`  ✗ ${m}`);
};

/** Redact to a shape, never a value — same style as circle-preflight.ts. */
function keyShape(key: string): string {
  const [prefix, id = ""] = key.split(":");
  return `${prefix}:${id.slice(0, 4)}…:${"•".repeat(8)}`;
}

/** Read a sibling lib source file (the authority on what the app sends). */
function readLibSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../lib/${relative}`, import.meta.url)), "utf8");
}

/** Extract `const NAME = "value"` (any trailing `as const` etc.) from source. */
function extractStringConst(source: string, constName: string, file: string): string {
  const match = new RegExp(`(?:const|type) ${constName}\\s*=\\s*"([^"]+)"`).exec(source);
  if (!match) throw new Error(`could not find '${constName} = "..."' in ${file}`);
  return match[1];
}

function expect(label: string, actual: unknown, wanted: unknown): boolean {
  if (actual === wanted) {
    ok(`${label}: ${String(actual)}`);
    return true;
  }
  bad(`${label}: expected ${String(wanted)}, installed SDK says ${String(actual)}`);
  return false;
}

function offlineLayer(): boolean {
  let passed = true;
  console.log("Offline — installed-SDK identifier validation");

  // DCW — the app provisions wallets with blockchain "ARC"
  //    (agent-wallet-create.ts). The union is asserted at compile time
  //    above; here the source id must equal that literal.
  passed =
    expect(
      'agent-wallet-create.ts CircleBlockchain (DCW "ARC")',
      extractStringConst(
        readLibSource("agent-wallet-create.ts"),
        "CircleBlockchain",
        "agent-wallet-create.ts",
      ),
      DCW_ARC_ID,
    ) && passed;
  ok(
    `developer-controlled-wallets Blockchain union carries "${DCW_ARC_ID}" and "${DCW_ARC_TESTNET_ID}" (compile time)`,
  );

  return passed;
}

/** DCW blockchain ids that mean "the Arc family" — mainnet or testnet. */
const ARC_FAMILY = new Set<string>([DCW_ARC_ID, DCW_ARC_TESTNET_ID]);

async function liveLayer(): Promise<boolean | null> {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
  console.log("\nLive — one listWallets round-trip");
  if (!apiKey) {
    console.log("  – SKIPPED: CIRCLE_API_KEY not set (offline layer is authoritative)");
    return null;
  }
  if (!entitySecret) {
    console.log(
      "  – SKIPPED: CIRCLE_API_KEY is set but CIRCLE_ENTITY_SECRET is not — the SDK client needs both",
    );
    return null;
  }
  console.log(`  key: ${keyShape(apiKey)} (entity secret present, never logged)`);
  try {
    const { initiateDeveloperControlledWalletsClient } =
      await import("@circle-fin/developer-controlled-wallets");
    const baseUrl = process.env.CIRCLE_API_BASE_URL?.trim();
    const client = initiateDeveloperControlledWalletsClient({
      apiKey,
      entitySecret,
      ...(baseUrl ? { baseUrl } : {}),
    });
    const walletSetId = process.env.CIRCLE_WALLET_SET_ID?.trim();
    const wallets = await client.listWallets({
      ...(walletSetId ? { walletSetId } : {}),
      pageSize: 50,
    });
    const observed = new Set(
      (wallets.data?.wallets ?? []).map((w) => w.blockchain as string).filter(Boolean),
    );
    if (observed.size === 0) {
      bad(
        "listWallets returned no wallets — cannot confirm an ARC-family blockchain value round-trips. Provision a wallet (circle:e2e does this) and re-run.",
      );
      return false;
    }
    const arcFamily = [...observed].filter((b) => ARC_FAMILY.has(b));
    if (arcFamily.length > 0) {
      ok(`ARC-family blockchain round-tripped from the live API: ${arcFamily.join(", ")}`);
      return true;
    }
    bad(
      `listWallets returned wallets, but none on an ARC-family chain — observed: ${[...observed].join(", ")}`,
    );
    return false;
  } catch (err) {
    bad(`live listWallets failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main(): Promise<number> {
  console.log("\nCircle chain-identifier smoke (C-014)\n");
  const offline = offlineLayer();
  const live = await liveLayer();
  const failed = !offline || live === false;
  console.log(
    failed
      ? "\nResult: FAILED — an identifier the app assumes is missing (or the live check failed).\n"
      : `\nResult: all identifiers found${live === null ? " (live layer skipped — no credentials)" : ""}.\n`,
  );
  return failed ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
