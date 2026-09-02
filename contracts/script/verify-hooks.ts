/**
 * P5-001 — Hook deployment verification.
 *
 * For each hook in the suite, fetch the on-chain bytecode at its
 * configured Base Mainnet address, record a keccak256 hash for
 * change-detection, and decode the permission flags encoded in the
 * lower 14 bits of the hook's CREATE2 address (per Uniswap v4
 * Hooks.sol).
 *
 * Mantua's hooks are not yet deployed on Base Mainnet (8453), so the
 * expected addresses come from env vars rather than being hard-coded:
 *
 *   STABLE_PROTECTION_HOOK_ADDRESS
 *   DYNAMIC_FEE_HOOK_ADDRESS
 *   DYNAMIC_MARKET_HOOK_ADDRESS
 *
 * A hook with no configured address is reported as "pending mainnet
 * deployment" — that is an expected state, not a failure. Once a hook
 * is deployed, set its env var (and the server env) and re-run.
 *
 * Run:  tsx contracts/script/verify-hooks.ts [--write]
 *
 * --write appends/overwrites docs/security/hook-deployments.md with
 * a markdown report. Without --write, output goes to stdout only.
 */

import { keccak256, type Hex } from "viem";
import { writeFileSync } from "node:fs";

interface HookConfig {
  name: string;
  repo: string;
  pinnedCommit: string;
  addressEnvVar: string;
  address: `0x${string}` | null;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  expectedPermissions?: string[];
}

const BASE_CHAIN_ID = 8453;

/** Base Mainnet RPC — override with BASE_RPC_URL for a non-rate-limited
 *  endpoint (the public default is fine for bytecode checks). */
const BASE_RPC = process.env["BASE_RPC_URL"] ?? "https://mainnet.base.org";

function envAddress(name: string): `0x${string}` | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`${name} is not a valid 0x address: ${raw}`);
  }
  return raw as `0x${string}`;
}

const HOOKS: HookConfig[] = [
  {
    name: "StableProtectionHook",
    repo: "DelleonMcglone/stableprotection-hook",
    pinnedCommit: "1282b899b6f68d27e28d65194dc75661f23476af",
    addressEnvVar: "STABLE_PROTECTION_HOOK_ADDRESS",
    address: envAddress("STABLE_PROTECTION_HOOK_ADDRESS"),
    chainId: BASE_CHAIN_ID,
    chainName: "Base",
    rpcUrl: BASE_RPC,
    expectedPermissions: ["BEFORE_INITIALIZE", "BEFORE_SWAP", "AFTER_SWAP"],
  },
  {
    name: "DynamicFee",
    repo: "DelleonMcglone/dynamic-fee",
    pinnedCommit: "62710d6d9b403557b073a702b5546bc10e75c0c6",
    addressEnvVar: "DYNAMIC_FEE_HOOK_ADDRESS",
    address: envAddress("DYNAMIC_FEE_HOOK_ADDRESS"),
    chainId: BASE_CHAIN_ID,
    chainName: "Base",
    rpcUrl: BASE_RPC,
    expectedPermissions: ["BEFORE_SWAP", "AFTER_SWAP"],
  },
  {
    name: "DynamicMarketHook",
    repo: "DelleonMcglone/Mantua-Intelligence",
    pinnedCommit: "07f6f169fb79172c01f4a7d1dd68e9850a132ace",
    addressEnvVar: "DYNAMIC_MARKET_HOOK_ADDRESS",
    address: envAddress("DYNAMIC_MARKET_HOOK_ADDRESS"),
    chainId: BASE_CHAIN_ID,
    chainName: "Base",
    rpcUrl: BASE_RPC,
    expectedPermissions: ["BEFORE_INITIALIZE", "BEFORE_ADD_LIQUIDITY", "BEFORE_SWAP", "AFTER_SWAP"],
  },
];

/** Uniswap v4 Hooks.sol permission flags (lower 14 bits of hook address). */
const HOOK_FLAGS = {
  BEFORE_INITIALIZE: 1 << 13,
  AFTER_INITIALIZE: 1 << 12,
  BEFORE_ADD_LIQUIDITY: 1 << 11,
  AFTER_ADD_LIQUIDITY: 1 << 10,
  BEFORE_REMOVE_LIQUIDITY: 1 << 9,
  AFTER_REMOVE_LIQUIDITY: 1 << 8,
  BEFORE_SWAP: 1 << 7,
  AFTER_SWAP: 1 << 6,
  BEFORE_DONATE: 1 << 5,
  AFTER_DONATE: 1 << 4,
  BEFORE_SWAP_RETURNS_DELTA: 1 << 3,
  AFTER_SWAP_RETURNS_DELTA: 1 << 2,
  AFTER_ADD_LIQUIDITY_RETURNS_DELTA: 1 << 1,
  AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA: 1 << 0,
} as const;

function decodePermissions(address: string): string[] {
  const lower14 = parseInt(address.slice(-4), 16) & 0x3fff;
  return Object.entries(HOOK_FLAGS)
    .filter(([, flag]) => (lower14 & flag) !== 0)
    .map(([name]) => name);
}

interface VerifyResult {
  hook: HookConfig;
  configured: boolean;
  deployed: boolean;
  bytecodeLength: number;
  bytecodeHash: string | null;
  permissions: string[];
  permissionsMatch: boolean | null;
  error?: string;
}

async function verify(hook: HookConfig): Promise<VerifyResult> {
  if (hook.address === null) {
    return {
      hook,
      configured: false,
      deployed: false,
      bytecodeLength: 0,
      bytecodeHash: null,
      permissions: [],
      permissionsMatch: null,
    };
  }

  const permissions = decodePermissions(hook.address);
  const permissionsMatch = hook.expectedPermissions
    ? hook.expectedPermissions.every((p) => permissions.includes(p)) &&
      permissions.length === hook.expectedPermissions.length
    : null;

  try {
    const res = await fetch(hook.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [hook.address, "latest"],
      }),
    });
    if (!res.ok) {
      return {
        hook,
        configured: true,
        deployed: false,
        bytecodeLength: 0,
        bytecodeHash: null,
        permissions,
        permissionsMatch,
        error: `rpc http ${res.status}`,
      };
    }
    const json = (await res.json()) as { result?: string; error?: { message?: string } };
    if (json.error) {
      return {
        hook,
        configured: true,
        deployed: false,
        bytecodeLength: 0,
        bytecodeHash: null,
        permissions,
        permissionsMatch,
        error: json.error.message ?? "rpc error",
      };
    }
    const code = json.result ?? "0x";
    const deployed = code !== "0x" && code.length > 2;
    return {
      hook,
      configured: true,
      deployed,
      bytecodeLength: deployed ? (code.length - 2) / 2 : 0,
      bytecodeHash: deployed ? keccak256(code as Hex) : null,
      permissions,
      permissionsMatch,
    };
  } catch (err) {
    return {
      hook,
      configured: true,
      deployed: false,
      bytecodeLength: 0,
      bytecodeHash: null,
      permissions,
      permissionsMatch,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function renderMarkdown(results: VerifyResult[]): string {
  const lines: string[] = [];
  lines.push("# Hook deployment verification (P5-001)");
  lines.push("");
  lines.push(`Last run: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "| Hook | Chain | Address | Deployed | Bytecode size | Bytecode hash | Permissions | Match |",
  );
  lines.push("|---|---|---|---|---:|---|---|---|");
  for (const r of results) {
    const chain = `${r.hook.chainName} (${String(r.hook.chainId)})`;
    const addr = r.hook.address
      ? `\`${r.hook.address}\``
      : `⏳ pending (\`${r.hook.addressEnvVar}\` unset)`;
    const dep = !r.configured ? "—" : r.deployed ? "✅" : "❌";
    const size = r.deployed ? `${String(r.bytecodeLength)} B` : "—";
    const hash = r.bytecodeHash ? `\`${r.bytecodeHash.slice(0, 18)}…\`` : (r.error ?? "—");
    const perms = r.permissions.length > 0 ? r.permissions.join(", ") : "—";
    const match = r.permissionsMatch === null ? "n/a" : r.permissionsMatch ? "✅" : "❌";
    lines.push(
      `| \`${r.hook.name}\` | ${chain} | ${addr} | ${dep} | ${size} | ${hash} | ${perms} | ${match} |`,
    );
  }
  lines.push("");
  lines.push("## Pinned source commits");
  lines.push("");
  for (const r of results) {
    lines.push(
      `- \`${r.hook.name}\` — [${r.hook.repo}@${r.hook.pinnedCommit.slice(0, 7)}](https://github.com/${r.hook.repo}/commit/${r.hook.pinnedCommit})`,
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "Mantua targets Base Mainnet (8453) only. Hooks marked pending have no mainnet deployment yet — deploying them, then re-running this verification with the address env vars set, is a launch-gating step.",
  );
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const results = await Promise.all(HOOKS.map((h) => verify(h)));
  const md = renderMarkdown(results);
  console.log(md);

  const pending = results.filter((r) => !r.configured);
  if (pending.length > 0) {
    console.log(
      `${String(pending.length)} hook(s) pending mainnet deployment (address env var unset) — not a failure.`,
    );
  }

  if (process.argv.includes("--write")) {
    writeFileSync("docs/security/hook-deployments.md", md);
    console.log("Wrote docs/security/hook-deployments.md");
  }

  // Only a *configured* hook that is missing bytecode or has wrong
  // permission bits fails the run. Unconfigured (pending) hooks do not.
  const failed = results.filter((r) => r.configured && (!r.deployed || r.permissionsMatch === false));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();
