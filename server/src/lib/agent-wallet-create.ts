import { env } from "../env.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { getCircleClient } from "./circle/client.ts";

/**
 * The one place a Circle Developer-Controlled Wallet is minted. Shared by
 * the retail provisioner (`agent-wallet.ts`) and the institutional
 * segregation path (task 074, `custody/custody-wallet-set.ts`): the wallet
 * set is the caller's choice, everything else — SCA account, the pinned
 * SCA core — is the same for every wallet Mantua creates.
 */

/** Circle blockchain ids per supported chain. */
export type CircleBlockchain = "BASE";
const CIRCLE_BLOCKCHAIN: Record<SupportedChainId, CircleBlockchain> = {
  [BASE_CHAIN_ID]: "BASE",
};

export function circleBlockchainFor(chainId: SupportedChainId): CircleBlockchain {
  return CIRCLE_BLOCKCHAIN[chainId];
}

export async function createCircleWallet(
  walletSetId: string,
  blockchain: CircleBlockchain,
): Promise<{ id: string; address: string }> {
  const client = await getCircleClient();
  // Pin the SCA version (CIRCLE_SCA_CORE) so a wallet created on any chain
  // under this wallet set derives the same address as the existing ones —
  // the property gateway spends rely on (they default the destination
  // recipient to the agent's own address). Circle's platform default
  // changes on 2026-09-14; the installed SDK types predate the field, but
  // the client spreads every input into the request body, so it reaches
  // the API. Runbook §11.
  const input: Parameters<typeof client.createWallets>[0] & {
    scaConfiguration: { scaCore: string };
  } = {
    blockchains: [blockchain],
    count: 1,
    walletSetId,
    accountType: "SCA",
    scaConfiguration: { scaCore: env.CIRCLE_SCA_CORE },
  };
  const created = await client.createWallets(input);
  const wallet = created.data?.wallets.at(0);
  if (!wallet?.id || !wallet.address) {
    throw new Error("Circle createWallets returned no wallet");
  }
  return { id: wallet.id, address: wallet.address.toLowerCase() };
}
