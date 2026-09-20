import type { DB } from "../../db/client.ts";
import type { SupportedChainId } from "../chains.ts";
import { getCircleClient } from "../circle/client.ts";
import { logger } from "../logger.ts";
import { getToken } from "../tokens.ts";
import { usdcBalanceOf } from "./custody-chain.ts";
import {
  circleUsdcRaw,
  reconcileWallet,
  type CircleBalanceLine,
  type WalletReconciliation,
} from "./custody-reconcile.ts";
import { institutionWallets } from "./custody-store.ts";

/**
 * Task 073 / IC-001 — reconciliation, the IO half: for every member
 * wallet, the USDC balance Circle reports for the wallet id against the
 * chain's `balanceOf` for its address. A failed read on either side is
 * `unavailable` for that wallet; a Circle client that cannot be built at
 * all (no credentials) throws `CircleUnavailableError` for the route.
 */
export async function reconcileInstitution(
  db: DB,
  institutionId: string,
  chainId: SupportedChainId,
): Promise<WalletReconciliation[]> {
  const client = await getCircleClient();
  const usdc = getToken("USDC", chainId).address;
  const wallets = await institutionWallets(db, institutionId);
  return Promise.all(
    wallets.map(async (w) => {
      const [circleRaw, chainRaw] = await Promise.all([
        client
          .getWalletTokenBalance({ id: w.circleWalletId })
          .then((res) =>
            circleUsdcRaw((res.data?.tokenBalances ?? []) as CircleBalanceLine[], usdc),
          )
          .catch((err: unknown) => {
            logger.warn({ err, wallet: w.address }, "custody: Circle balance read failed");
            return null;
          }),
        usdcBalanceOf(chainId, w.address).catch((err: unknown) => {
          logger.warn({ err, wallet: w.address }, "custody: chain balance read failed");
          return null;
        }),
      ]);
      return reconcileWallet({
        address: w.address,
        circleWalletId: w.circleWalletId,
        circleRaw,
        chainRaw,
      });
    }),
  );
}
