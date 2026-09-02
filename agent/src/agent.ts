/**
 * Composition root — builds the Base agent's action registry.
 *
 * Providers: ERC-8004 identity/reputation, ERC-8183 jobs, and balances,
 * bound to a plain viem wallet on Base Mainnet (no Coinbase AgentKit /
 * CDP). The ERC-8004 and ERC-8183 providers are skipped until their
 * contract addresses are configured (Base Mainnet deployment pending —
 * see docs/tasks/v2-roadmap.md).
 */
import { loadContractConfig } from "./config/contracts.ts";
import { loadEnv } from "./config/env.ts";
import { createBalancesActionProvider } from "./action-providers/balances.ts";
import { createErc8004ActionProvider } from "./action-providers/erc8004.ts";
import { createErc8183ActionProvider } from "./action-providers/erc8183.ts";
import { createActionKit, type ActionKit, type ActionProvider } from "./lib/action-kit.ts";
import { createBaseWallet } from "./lib/wallet.ts";

export function createBaseAgentKit(): ActionKit {
  const env = loadEnv();
  const contracts = loadContractConfig(env);
  const wallet = createBaseWallet(env);

  const providers: ActionProvider[] = [];
  if (contracts.erc8004) {
    providers.push(createErc8004ActionProvider(contracts.erc8004));
  } else {
    console.warn(
      "ERC-8004 registry addresses not set — identity/reputation actions disabled (Base Mainnet deployment pending).",
    );
  }
  if (contracts.agenticCommerce) {
    providers.push(
      createErc8183ActionProvider({
        agenticCommerce: contracts.agenticCommerce,
        usdc: contracts.usdc,
      }),
    );
  } else {
    console.warn(
      "AGENTIC_COMMERCE_ADDRESS not set — ERC-8183 job actions disabled (Base Mainnet deployment pending).",
    );
  }
  providers.push(
    createBalancesActionProvider({
      allowlist: contracts.allowlist,
      lowGasWarnEth: env.LOW_GAS_WARN_ETH,
    }),
  );

  return createActionKit(wallet, providers);
}
