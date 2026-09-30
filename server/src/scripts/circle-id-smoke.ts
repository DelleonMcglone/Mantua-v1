/**
 * C-014 — chain-identifier smoke test. `npm run circle:id-smoke -w @mantua/server`.
 *
 * Chain identifiers are stringly-typed at every Circle boundary the app
 * crosses, and each SDK family spells them differently:
 *
 *   - Developer-Controlled Wallets / Smart Contract Platform use SCREAMING
 *     ids ("ARC", "ARC-TESTNET")
 *   - Bridge Kit / Unified Balance Kit use TitleCase names ("Arc",
 *     "Arc_Testnet", "Ethereum")
 *
 * A silent rename in an SDK upgrade would not fail typecheck where the app
 * passes plain strings, so this script re-validates every identifier the app
 * assumes against the INSTALLED SDKs in node_modules.
 *
 * Two layers:
 *
 *   OFFLINE (always runs, no credentials, no network):
 *     - the DCW and SCP `Blockchain` unions contain "ARC" and "ARC-TESTNET"
 *       (compile time), and the ids the app persists/sends
 *       (agent-wallet-create.ts, circle-contracts.ts) are those literals
 *     - the Bridge Kit home chain + every destination agent-bridge.ts
 *       passes exist in the installed kit's `BridgeChain` enum, and the
 *       kit's Arc definition is chain 5042 / mainnet / USDC 0x3600…0000
 *     - the Unified Balance Kit home chain + every destination
 *       unified-balance.ts passes exist in the installed kit's
 *       `UnifiedBalanceChain` enum
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
import type { Blockchain as ScpBlockchain } from "@circle-fin/smart-contract-platform";

// ── Compile-time assertions ─────────────────────────────────────────────────
// If an SDK upgrade drops an Arc id from a `Blockchain` union, `npm run
// typecheck` fails on these lines before the script even runs.
const DCW_ARC_ID: DcwBlockchain = "ARC";
const DCW_ARC_TESTNET_ID: DcwBlockchain = "ARC-TESTNET";
const SCP_ARC_ID: ScpBlockchain = "ARC";

/** Arc Mainnet as the app knows it (server/src/lib/chains.ts, tokens.ts). */
const ARC_CHAIN_ID = 5042;
const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_USDC = "0x3600000000000000000000000000000000000000";

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

/** Extract `const NAME = "value"` (any trailing `as const` etc.) from source. */
function extractStringConst(source: string, constName: string, file: string): string {
  const match = new RegExp(`(?:const|type) ${constName}\\s*=\\s*"([^"]+)"`).exec(source);
  if (!match) throw new Error(`could not find '${constName} = "..."' in ${file}`);
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

function expect(label: string, actual: unknown, wanted: unknown): boolean {
  if (actual === wanted) {
    ok(`${label}: ${String(actual)}`);
    return true;
  }
  bad(`${label}: expected ${String(wanted)}, installed SDK says ${String(actual)}`);
  return false;
}

/** A kit's chain definition object (bridge-kit exports one per chain). */
interface KitChainDef {
  chain?: string;
  chainId?: number;
  isTestnet?: boolean;
  usdcAddress?: string;
}

async function offlineLayer(): Promise<boolean> {
  let passed = true;
  console.log("Offline — installed-SDK identifier validation");

  // 1. DCW / SCP — the app provisions wallets and deploys contracts with
  //    blockchain "ARC" (agent-wallet-create.ts, circle-contracts.ts). The
  //    unions are asserted at compile time above; here the source ids must
  //    equal those literals.
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
  passed =
    expect(
      'circle-contracts.ts ARC_BLOCKCHAIN (SCP "ARC")',
      extractStringConst(
        readLibSource("circle-contracts.ts"),
        "ARC_BLOCKCHAIN",
        "circle-contracts.ts",
      ),
      SCP_ARC_ID,
    ) && passed;
  ok(
    `developer-controlled-wallets Blockchain union carries "${DCW_ARC_ID}" and "${DCW_ARC_TESTNET_ID}" (compile time)`,
  );

  // 2. Bridge Kit — agent-bridge.ts bridges from HOME_CHAIN to each entry of
  //    AGENT_BRIDGE_DESTINATIONS, passing these names as `chain`.
  const bridgeSource = readLibSource("agent-bridge.ts");
  const bridgeHome = extractStringConst(bridgeSource, "HOME_CHAIN", "agent-bridge.ts");
  const bridgeIds = [
    bridgeHome,
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
    passed = checkIds("bridge-kit BridgeChain (dev)", ["Arc_Testnet"], bridgeChainValues) && passed;
  } else {
    bad("bridge-kit exports no BridgeChain enum — cannot validate bridge chain names");
    passed = false;
  }
  // The kit's own Arc definitions must describe the chain the app runs on.
  const arc = bk["Arc"] as KitChainDef | undefined;
  const arcTestnet = bk["ArcTestnet"] as KitChainDef | undefined;
  passed = expect("bridge-kit Arc.chain", arc?.chain, bridgeHome) && passed;
  passed = expect("bridge-kit Arc.chainId", arc?.chainId, ARC_CHAIN_ID) && passed;
  passed = expect("bridge-kit Arc.isTestnet", arc?.isTestnet, false) && passed;
  passed =
    expect("bridge-kit Arc.usdcAddress", arc?.usdcAddress?.toLowerCase(), ARC_USDC) && passed;
  passed =
    expect("bridge-kit ArcTestnet.chainId", arcTestnet?.chainId, ARC_TESTNET_CHAIN_ID) && passed;

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
    passed =
      checkIds("unified-balance-kit UnifiedBalanceChain (dev)", ["Arc_Testnet"], ubkValues) &&
      passed;
  } else {
    bad(
      "unified-balance-kit exports no UnifiedBalanceChain/Blockchain enum — cannot validate Gateway chain names",
    );
    passed = false;
  }

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
