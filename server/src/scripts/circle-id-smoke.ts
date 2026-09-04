/**
 * C-014 — chain-identifier smoke test. `npm run circle:id-smoke -w @mantua/server`.
 *
 * Chain identifiers are stringly-typed at every Circle boundary the app
 * crosses, and each SDK family spells them differently:
 *
 *   - Developer-Controlled Wallets uses SCREAMING ids ("BASE", "BASE-SEPOLIA")
 *   - Bridge Kit / Unified Balance Kit use TitleCase names ("Base", "Ethereum")
 *
 * A silent rename in an SDK upgrade would not fail typecheck where the app
 * passes plain strings, so this script re-validates every identifier the app
 * assumes against the INSTALLED SDKs in node_modules.
 *
 * Two layers:
 *
 *   OFFLINE (always runs, no credentials, no network):
 *     - the DCW `Blockchain` union contains "BASE" (audit-verified once;
 *       re-asserted here both at compile time and against the runtime enum)
 *     - every chain name agent-bridge.ts passes to Bridge Kit exists in the
 *       installed Bridge Kit's `BridgeChain`/`Blockchain` enums
 *     - every chain name unified-balance.ts passes to Unified Balance Kit
 *       exists in the installed kit's `UnifiedBalanceChain` enum
 *     The app-side lists are extracted from the SOURCE FILES, not duplicated
 *     here, so this cannot drift from what the code actually sends.
 *
 *   LIVE (only when CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET are set):
 *     - one listWallets call asserting a BASE-family blockchain value
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

// ── Compile-time re-assertion of the C-014 audit finding ────────────────────
// If a DCW upgrade drops "BASE" from the `Blockchain` union, `npm run
// typecheck` fails on this line before the script even runs.
const DCW_BASE_ID: DcwBlockchain = "BASE";

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

/** Extract the quoted strings of `const NAME = [ ... ]` from source text. */
function extractStringArray(source: string, constName: string, file: string): string[] {
  const match = new RegExp(`${constName}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!match) throw new Error(`could not find "const ${constName} = [...]" in ${file}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Extract `const NAME = "value"` from source text. */
function extractStringConst(source: string, constName: string, file: string): string {
  const match = new RegExp(`const ${constName}\\s*=\\s*"([^"]+)"`).exec(source);
  if (!match) throw new Error(`could not find 'const ${constName} = "..."' in ${file}`);
  return match[1];
}

/** All string values of an exported enum/const-object, or null when absent. */
function enumValues(mod: Record<string, unknown>, exportName: string): Set<string> | null {
  const exported = mod[exportName];
  if (typeof exported !== "object" || exported === null) return null;
  return new Set(Object.values(exported).filter((v): v is string => typeof v === "string"));
}

/** Check each id against a value set; report per id; return pass/fail. */
function checkIds(label: string, ids: readonly string[], values: Set<string>): boolean {
  let allFound = true;
  for (const id of ids) {
    if (values.has(id)) {
      ok(`${label}: "${id}" → found`);
    } else {
      bad(`${label}: "${id}" → NOT FOUND in installed SDK`);
      allFound = false;
    }
  }
  return allFound;
}

async function offlineLayer(): Promise<boolean> {
  let passed = true;
  console.log("Offline — installed-SDK identifier validation");

  // 1. DCW — the app provisions wallets with blockchain "BASE"
  //    (lib/agent-wallet.ts `CircleBlockchain`).
  const dcw = (await import("@circle-fin/developer-controlled-wallets")) as unknown as Record<
    string,
    unknown
  >;
  const dcwValues = enumValues(dcw, "Blockchain");
  if (dcwValues) {
    passed = checkIds("developer-controlled-wallets Blockchain", [DCW_BASE_ID], dcwValues) && passed;
  } else {
    // The union is importable as a type either way (asserted above at compile
    // time); a missing runtime export is informational, not a failure.
    ok(
      'developer-controlled-wallets exports no runtime Blockchain enum — "BASE" is asserted against the type union at compile time instead',
    );
  }

  // 2. Bridge Kit — agent-bridge.ts bridges from HOME_CHAIN to each entry of
  //    AGENT_BRIDGE_DESTINATIONS, passing these names as `chain`.
  const bridgeSource = readLibSource("agent-bridge.ts");
  const bridgeIds = [
    extractStringConst(bridgeSource, "HOME_CHAIN", "agent-bridge.ts"),
    ...extractStringArray(bridgeSource, "AGENT_BRIDGE_DESTINATIONS", "agent-bridge.ts"),
  ];
  const bk = (await import("@circle-fin/bridge-kit")) as unknown as Record<string, unknown>;
  // BridgeChain is the CCTPv2-bridgeable subset — the set that must contain
  // every chain the app offers as a bridge source/destination. Blockchain is
  // the kit's full chain universe; membership there alone is NOT enough to
  // bridge, so BridgeChain is the authoritative check.
  const bridgeChainValues = enumValues(bk, "BridgeChain");
  if (bridgeChainValues) {
    passed = checkIds("bridge-kit BridgeChain", bridgeIds, bridgeChainValues) && passed;
  } else {
    bad("bridge-kit exports no BridgeChain enum — cannot validate bridge chain names");
    passed = false;
  }

  // 3. Unified Balance Kit — unified-balance.ts spends from HOME_CHAIN to
  //    each entry of GATEWAY_SPEND_CHAINS, passing these names as `chain`.
  const ubSource = readLibSource("unified-balance.ts");
  const ubIds = [
    extractStringConst(ubSource, "HOME_CHAIN", "unified-balance.ts"),
    ...extractStringArray(ubSource, "GATEWAY_SPEND_CHAINS", "unified-balance.ts"),
  ];
  const ubk = (await import("@circle-fin/unified-balance-kit")) as unknown as Record<
    string,
    unknown
  >;
  const ubkValues = enumValues(ubk, "UnifiedBalanceChain") ?? enumValues(ubk, "Blockchain");
  if (ubkValues) {
    passed = checkIds("unified-balance-kit UnifiedBalanceChain", ubIds, ubkValues) && passed;
  } else {
    bad(
      "unified-balance-kit exports no UnifiedBalanceChain/Blockchain enum — cannot validate Gateway chain names",
    );
    passed = false;
  }

  return passed;
}

/** DCW blockchain ids that mean "the Base family" — mainnet or Sepolia. */
const BASE_FAMILY = new Set<string>(["BASE", "BASE-SEPOLIA"]);

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
    const { initiateDeveloperControlledWalletsClient } = await import(
      "@circle-fin/developer-controlled-wallets"
    );
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
        "listWallets returned no wallets — cannot confirm a BASE-family blockchain value round-trips. Provision a wallet (circle:e2e does this) and re-run.",
      );
      return false;
    }
    const baseFamily = [...observed].filter((b) => BASE_FAMILY.has(b));
    if (baseFamily.length > 0) {
      ok(`BASE-family blockchain round-tripped from the live API: ${baseFamily.join(", ")}`);
      return true;
    }
    bad(
      `listWallets returned wallets, but none on a BASE-family chain — observed: ${[...observed].join(", ")}`,
    );
    return false;
  } catch (err) {
    bad(`live listWallets failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main(): Promise<number> {
  console.log("\nCircle chain-identifier smoke (C-014)\n");
  const offline = await offlineLayer();
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
