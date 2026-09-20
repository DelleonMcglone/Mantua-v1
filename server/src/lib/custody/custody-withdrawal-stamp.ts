import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { custodyWithdrawals } from "../../db/schema/institutions.ts";

/**
 * Task 073 — the finalizer's stamp on a custody withdrawal. The send that
 * executes a withdrawal is a Circle `agent_send` execution; whichever
 * path finalizes it (the poll in `custody-withdrawal-exec.ts` or the
 * webhook finalizer in `circle/finalize.ts`) writes the same terminal
 * status here. Only a row still in its `executing` claim is touched, so
 * the two paths cannot disagree and a replay is a no-op.
 */
export async function stampWithdrawalFinal(
  db: DB,
  effect: {
    id: string;
    status: "executed" | "failed";
    txHash: string | null;
    error: string | null;
  },
): Promise<void> {
  await db
    .update(custodyWithdrawals)
    .set({
      status: effect.status,
      txHash: effect.txHash,
      lastError: effect.error,
      updatedAt: sql`now()`,
    })
    .where(and(eq(custodyWithdrawals.id, effect.id), eq(custodyWithdrawals.status, "executing")));
}
