import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { agentWallets } from "../../db/schema/agent.ts";
import { institutions, type Institution } from "../../db/schema/institutions.ts";
import { circleBlockchainFor, createCircleWallet } from "../agent-wallet-create.ts";
import type { SupportedChainId } from "../chains.ts";
import { getAgentWalletSetId, getCircleClient } from "../circle/client.ts";
import { logger } from "../logger.ts";
import { holdingsEmpty, walletHoldings, type WalletHoldings } from "./custody-chain.ts";
import { membershipForUser } from "./custody-store.ts";

/**
 * Task 074 / IC-001 — segregation in Circle terms (D-120). An institution
 * owns a Circle wallet set of its own; its members' agent wallets are
 * created there, never in the retail set, so Circle's per-set controls
 * and balances scope to the institution alone.
 */

export class CustodyUnprovisionedError extends Error {
  constructor(name: string) {
    super(
      `${name} has no custody wallet set yet. The operator provisions it (POST /api/ops/institutions/:id/provision) before members' wallets can be created.`,
    );
    this.name = "CustodyUnprovisionedError";
  }
}

/** The wallet set a new agent wallet for this user belongs in. */
export async function walletSetForUser(db: DB, userId: string): Promise<string> {
  const m = await membershipForUser(db, userId);
  if (!m || m.member.status !== "active") return getAgentWalletSetId();
  if (!m.institution.circleWalletSetId) throw new CustodyUnprovisionedError(m.institution.name);
  return m.institution.circleWalletSetId;
}

/** Create the institution's Circle wallet set once; activates a pending institution. */
export async function provisionInstitutionWalletSet(
  db: DB,
  institution: Institution,
): Promise<Institution> {
  if (institution.circleWalletSetId) return institution;
  const client = await getCircleClient();
  const res = await client.createWalletSet({ name: `Mantua Institution ${institution.slug}` });
  const id = res.data?.walletSet.id;
  if (!id) throw new Error("Circle createWalletSet returned no wallet set id");
  const rows = await db
    .update(institutions)
    .set({
      circleWalletSetId: id,
      status: institution.status === "pending" ? "active" : institution.status,
      updatedAt: sql`now()`,
    })
    .where(eq(institutions.id, institution.id))
    .returning();
  logger.info(
    { institutionId: institution.id, walletSetId: id },
    "custody: wallet set provisioned",
  );
  return rows[0];
}

export type SegregateResult =
  | { kind: "not_member" }
  | { kind: "unprovisioned" }
  | { kind: "already"; address: string }
  | { kind: "created"; address: string }
  | { kind: "moved"; address: string; previous: string; previousCircleWalletId: string }
  | { kind: "not_empty"; address: string; holdings: WalletHoldings };

/**
 * Put the member's agent wallet in the institution's set: create one when
 * none exists; leave one already there; replace a retail-set wallet only
 * when it holds nothing — no app token, no open market position (the
 * member sweeps and closes first; funds are never moved by this path).
 * History keyed on the old address (fills, transactions, the spend
 * ledger) stays with that address; the old Circle wallet is left empty.
 */
export async function segregateAgentWallet(
  db: DB,
  input: { userId: string; chainId: SupportedChainId },
): Promise<SegregateResult> {
  const m = await membershipForUser(db, input.userId);
  if (!m || m.member.status !== "active") return { kind: "not_member" };
  const setId = m.institution.circleWalletSetId;
  if (!setId) return { kind: "unprovisioned" };
  const blockchain = circleBlockchainFor(input.chainId);
  const existing = (
    await db
      .select()
      .from(agentWallets)
      .where(and(eq(agentWallets.userId, input.userId), eq(agentWallets.blockchain, blockchain)))
      .limit(1)
  ).at(0);
  if (existing?.walletSetId === setId) return { kind: "already", address: existing.address };
  if (existing) {
    const holdings = await walletHoldings(input.chainId, existing.address);
    if (!holdingsEmpty(holdings)) return { kind: "not_empty", address: existing.address, holdings };
  }
  const fresh = await createCircleWallet(setId, blockchain);
  if (existing) {
    await db
      .update(agentWallets)
      .set({
        circleWalletId: fresh.id,
        address: fresh.address,
        walletSetId: setId,
        updatedAt: sql`now()`,
      })
      .where(eq(agentWallets.id, existing.id));
    // The old wallet stays with Circle, empty; its id and address go to the
    // audit log through this result so the operator can always find it.
    return {
      kind: "moved",
      address: fresh.address,
      previous: existing.address,
      previousCircleWalletId: existing.circleWalletId,
    };
  }
  await db.insert(agentWallets).values({
    userId: input.userId,
    blockchain,
    circleWalletId: fresh.id,
    address: fresh.address,
    walletSetId: setId,
  });
  return { kind: "created", address: fresh.address };
}
