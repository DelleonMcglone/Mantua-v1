import type * as SCP from "@circle-fin/smart-contract-platform";
import { env } from "../env.ts";
import { logger } from "./logger.ts";
import { CircleUnavailableError } from "./circle/client.ts";
import { buildPoolKey } from "./pool-key.ts";
import { computePoolId } from "./pool-id.ts";
import { getHookAddress } from "./v4-contracts.ts";
import { DEFAULT_CHAIN_ID } from "./chains.ts";
import { BASESCAN_WEB } from "./basescan.ts";

/**
 * Circle Contracts (Smart Contract Platform) integration — the agent reads the
 * FX-aware Stable Protection hook's live guard state THROUGH Circle's Contracts
 * API (import + queryContract) instead of raw RPC; queryContract decodes
 * pegReferenceX18 / currentDeviationBps / owner.
 *
 * Same lazy-load pattern as unified-balance.ts / circle/client.ts: the SDK is
 * imported inside the call path (prebundled into api/_dcw.mjs for Vercel) so a
 * load failure degrades to a clean "unavailable" instead of a boot crash.
 */

const BASE_BLOCKCHAIN = "BASE";
/** Dynamic-fee tier the SP USDC/EURC pool actually uses. */
const SP_FEE_TIER = 100;

// Zone bands mirror the hook's PegMonitor thresholds (bps).
const ZONES: { max: number; zone: string }[] = [
  { max: 10, zone: "HEALTHY" },
  { max: 50, zone: "MINOR" },
  { max: 200, zone: "MODERATE" },
  { max: 500, zone: "SEVERE" },
];

let scpModule: Promise<typeof SCP> | null = null;
function loadScp(): Promise<typeof SCP> {
  scpModule ??= import("@circle-fin/smart-contract-platform");
  return scpModule;
}

export class ScpUnavailableError extends Error {
  constructor(message = "Circle Contracts is unavailable.") {
    super(message);
    this.name = "ScpUnavailableError";
  }
}

/** The SP hook address, or a clean "unavailable" while the Base Mainnet
 *  deployment is pending (env-overridable — see v4-contracts.ts). */
function requireSpHook(): `0x${string}` {
  const hook = getHookAddress("stable-protection", DEFAULT_CHAIN_ID);
  if (!hook) {
    throw new ScpUnavailableError(
      "Stable Protection hook is not deployed on Base Mainnet yet.",
    );
  }
  return hook;
}

type ScpClient = ReturnType<typeof SCP.initiateSmartContractPlatformClient>;
let cachedClient: ScpClient | null = null;

async function getScpClient(): Promise<ScpClient> {
  if (cachedClient) return cachedClient;
  const { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET } = env;
  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) throw new CircleUnavailableError();
  let scp: typeof SCP;
  try {
    scp = await loadScp();
  } catch (err) {
    logger.error({ err }, "SCP SDK failed to load");
    throw new ScpUnavailableError();
  }
  cachedClient = scp.initiateSmartContractPlatformClient({
    apiKey: CIRCLE_API_KEY,
    entitySecret: CIRCLE_ENTITY_SECRET,
  });
  return cachedClient;
}

/** Import the SP hook into Circle Contracts once; returns the contract id. */
let importedContractId: string | null = null;
export async function ensureHookImported(): Promise<string> {
  if (importedContractId) return importedContractId;
  const client = await getScpClient();
  const hook = requireSpHook();
  const list = await client.listContracts({ blockchain: BASE_BLOCKCHAIN as never });
  const items = (list.data?.contracts ?? []) as { id?: string; contractAddress?: string }[];
  const existing = items.find((c) => c.contractAddress?.toLowerCase() === hook.toLowerCase());
  if (existing?.id) {
    importedContractId = existing.id;
    return existing.id;
  }
  const res = await client.importContract({
    idempotencyKey: crypto.randomUUID(),
    name: "StableProtectionHook",
    address: hook,
    blockchain: BASE_BLOCKCHAIN,
  });
  const id = (res.data?.contract as { id?: string } | undefined)?.id;
  if (!id) throw new ScpUnavailableError("Contract import returned no id.");
  importedContractId = id;
  logger.info({ id, hook }, "SP hook imported into Circle Contracts");
  return id;
}

export interface HookGuardState {
  hook: string;
  poolId: string;
  owner: string;
  /** EUR/USD peg reference, human units (e.g. 1.14348). */
  pegReference: number;
  /** Live deviation from the FX-fair price, in bps; null when unreadable. */
  deviationBps: number | null;
  /** HEALTHY / MINOR / MODERATE / SEVERE / CRITICAL / NO_LIQUIDITY. */
  zone: string;
  circuitBreakerBlocksSwaps: boolean;
  contractId: string;
  explorerUrl: string;
  readVia: "circle-contracts";
}

const MAX_UINT256 = (1n << 256n) - 1n;

async function scpRead(address: string, fn: string, params?: unknown[]): Promise<bigint | null> {
  const client = await getScpClient();
  try {
    const res = await client.queryContract({
      address,
      blockchain: BASE_BLOCKCHAIN,
      abiFunctionSignature: fn,
      ...(params ? { abiParameters: params as never } : {}),
    });
    const out = (res.data as { outputData?: string } | undefined)?.outputData;
    if (typeof out !== "string" || !out.startsWith("0x")) return null;
    return BigInt(out);
  } catch (err) {
    logger.warn({ err, fn }, "SCP queryContract failed");
    return null;
  }
}

/**
 * Read the Stable Protection hook's live guard state through Circle Contracts:
 * peg reference (EUR/USD), current deviation, zone classification, owner.
 */
export async function readHookViaScp(): Promise<HookGuardState> {
  const spHook = requireSpHook();
  const { key } = buildPoolKey(
    "USDC",
    "EURC",
    SP_FEE_TIER,
    spHook,
    "stable-protection",
    DEFAULT_CHAIN_ID,
  );
  const poolId = computePoolId(key);

  const contractId = await ensureHookImported();
  const [refRaw, devRaw, ownerRaw] = await Promise.all([
    scpRead(spHook, "pegReferenceX18(bytes32)", [poolId]),
    scpRead(spHook, "currentDeviationBps(bytes32)", [poolId]),
    scpRead(spHook, "owner()"),
  ]);

  const pegReference = refRaw !== null ? Number(refRaw) / 1e18 : 0;
  let zone = "UNKNOWN";
  let deviationBps: number | null = null;
  if (devRaw !== null) {
    if (devRaw >= MAX_UINT256) {
      zone = "NO_LIQUIDITY"; // zero reserves — pool not seeded yet
    } else {
      const dev = Number(devRaw);
      deviationBps = dev;
      zone = ZONES.find((z) => dev <= z.max)?.zone ?? "CRITICAL";
    }
  }
  const owner = ownerRaw !== null ? `0x${ownerRaw.toString(16).padStart(40, "0")}` : "unknown";

  return {
    hook: spHook,
    poolId,
    owner,
    pegReference,
    deviationBps,
    zone,
    circuitBreakerBlocksSwaps: zone === "CRITICAL" || zone === "NO_LIQUIDITY",
    contractId,
    explorerUrl: `${BASESCAN_WEB}/address/${spHook}`,
    readVia: "circle-contracts",
  };
}
