/**
 * Balances action provider — reports the agent's Base balances for the
 * allowlisted assets (USDC/EURC/cbBTC via the 6/6/8-dp ERC-20 interface)
 * plus the native ETH gas balance, and warns when gas is low. Top up with
 * real funds (see docs/funding-runbook.md).
 */
import { type ActionProvider, type AgentWallet, customActionProvider } from "../lib/action-kit.ts";
import { formatEther, formatUnits, parseEther } from "viem";
import { z } from "zod";
import { ERC20_ABI } from "../abis/erc20.ts";
import type { AssetAllowlist } from "../config/assets.ts";

export interface BalancesConfig {
  allowlist: AssetAllowlist;
  /** Warn when the native ETH gas balance drops below this many ETH. */
  lowGasWarnEth: number;
}

export function createBalancesActionProvider(cfg: BalancesConfig): ActionProvider {
  return customActionProvider([
    {
      name: "check_balances",
      description:
        "Report the agent's Base balances for USDC, EURC, and cbBTC (ERC-20) plus the native ETH gas balance, warning when gas is low.",
      schema: z.object({}),
      invoke: async (wallet: AgentWallet) => {
        const address = wallet.getAddress() as `0x${string}`;
        const lines = await Promise.all(
          cfg.allowlist.all().map(async (a) => {
            const raw = await wallet.readContract({
              address: a.address,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [address],
            });
            return `${a.symbol}: ${formatUnits(raw, a.decimals)}`;
          }),
        );
        const gas = await wallet.getBalance();
        const gasHuman = formatEther(gas);
        const low = gas < parseEther(String(cfg.lowGasWarnEth));
        const warn = low
          ? `\n⚠️ Low gas: ETH balance ${gasHuman} is below ${String(cfg.lowGasWarnEth)} ETH. Top up the agent wallet (see docs/funding-runbook.md).`
          : "";
        return `Base balances for ${address}:\n  ${lines.join("\n  ")}\n  gas (ETH): ${gasHuman}${warn}`;
      },
    },
  ]);
}
