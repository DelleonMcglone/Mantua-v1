/**
 * Assembles typed contract config + the asset allowlist from validated
 * env. Single place that turns raw env addresses into the structured
 * config the action providers consume. Token decimals are protocol facts
 * (USDC 6, EURC 6, cbBTC 8); addresses come from env (never hardcoded).
 * The ERC-8004 registries and ERC-8183 AgenticCommerce contract are
 * `null` until their Base Mainnet deployments land (env-driven, no
 * defaults — see docs/tasks/v2-roadmap.md); the composition root skips
 * the matching providers when they are unset.
 */
import {
  type Asset,
  type AssetAllowlist,
  type AssetSymbol,
  createAssetAllowlist,
} from "./assets.ts";
import type { AgentEnv } from "./env.ts";

const TOKEN_DECIMALS: Record<AssetSymbol, number> = { USDC: 6, EURC: 6, cbBTC: 8 };

/** ERC-8004 registry addresses — all three or none. */
export interface Erc8004Registries {
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
  validationRegistry: `0x${string}`;
}

export interface ContractConfig {
  /** Null until the ERC-8004 registries are deployed on Base Mainnet. */
  erc8004: Erc8004Registries | null;
  /** Null until AgenticCommerce (ERC-8183) is deployed on Base Mainnet. */
  agenticCommerce: `0x${string}` | null;
  allowlist: AssetAllowlist;
  /** Convenience handle for the USDC asset (escrow funding). */
  usdc: Asset;
}

function loadErc8004Registries(env: AgentEnv): Erc8004Registries | null {
  const addresses = [
    env.IDENTITY_REGISTRY_ADDRESS,
    env.REPUTATION_REGISTRY_ADDRESS,
    env.VALIDATION_REGISTRY_ADDRESS,
  ];
  if (addresses.every((a) => a === undefined)) return null;
  if (addresses.some((a) => a === undefined)) {
    throw new Error(
      "Set all three ERC-8004 registry addresses (IDENTITY/REPUTATION/VALIDATION_REGISTRY_ADDRESS) or none.",
    );
  }
  return {
    identityRegistry: env.IDENTITY_REGISTRY_ADDRESS as `0x${string}`,
    reputationRegistry: env.REPUTATION_REGISTRY_ADDRESS as `0x${string}`,
    validationRegistry: env.VALIDATION_REGISTRY_ADDRESS as `0x${string}`,
  };
}

export function loadContractConfig(env: AgentEnv): ContractConfig {
  const assets: Asset[] = [
    { symbol: "USDC", address: env.USDC_ADDRESS as `0x${string}`, decimals: TOKEN_DECIMALS.USDC },
    { symbol: "EURC", address: env.EURC_ADDRESS as `0x${string}`, decimals: TOKEN_DECIMALS.EURC },
    {
      symbol: "cbBTC",
      address: env.CBBTC_ADDRESS as `0x${string}`,
      decimals: TOKEN_DECIMALS.cbBTC,
    },
  ];
  const allowlist = createAssetAllowlist(assets);
  return {
    erc8004: loadErc8004Registries(env),
    agenticCommerce: (env.AGENTIC_COMMERCE_ADDRESS as `0x${string}` | undefined) ?? null,
    allowlist,
    usdc: allowlist.requireAllowed("USDC"),
  };
}
