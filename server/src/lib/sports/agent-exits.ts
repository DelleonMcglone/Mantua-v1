/**
 * Prompt 5 — "…then manage the position for me." The agent arms a
 * take-profit / stop on a market position it holds; the strategy engine
 * (B9) watches the pool price on every tick and closes the position from
 * the agent wallet when a threshold is crossed. Arming is standing
 * authority to move money, so the tool sits behind the same preview →
 * confirm gate as a trade. Expiry defaults to the D-103 close.
 */
import { z } from "zod";
import type { DB } from "../../db/client.ts";
import { takeProfitStopSchema } from "./strategies.ts";
import { armStrategy, listStrategies } from "./strategy-store.ts";

export const armExitInput = z
  .object({
    marketId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    side: z.enum(["yes", "no"]),
    takeProfitBps: z.number().int().min(1).max(9999).optional(),
    stopBps: z.number().int().min(1).max(9999).optional(),
    /** The most the close may move, in USD. Defaults to 1,000. */
    capUsd: z.number().positive().max(10_000).optional(),
  })
  .strict();

export function describeExit(c: z.infer<typeof armExitInput>): string {
  const parts: string[] = [];
  if (c.takeProfitBps !== undefined)
    parts.push(`take profit when YES reaches ${String(c.takeProfitBps / 100)}%`);
  if (c.stopBps !== undefined) parts.push(`stop out when YES falls to ${String(c.stopBps / 100)}%`);
  return `${c.side.toUpperCase()} position: ${parts.join("; ")}.`;
}

export async function armExit(
  db: DB,
  userId: string,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = armExitInput.parse(raw);
  const config = takeProfitStopSchema.parse({
    kind: "take-profit-stop",
    ...input,
    capUsd: undefined,
  });
  const row = await armStrategy(db, userId, config, input.capUsd ?? 1_000, null);
  return {
    status: "armed",
    strategyId: row.id,
    rule: describeExit(input),
    note: "Checked on every live tick; closes from the agent wallet when crossed; disarms itself when the game goes final.",
  };
}

export async function listExits(db: DB, userId: string): Promise<Record<string, unknown>> {
  const rows = await listStrategies(db, userId);
  return {
    strategies: rows.map((r) => ({
      strategyId: r.id,
      status: r.status,
      marketId: r.marketId,
      config: r.config,
      capUsd: r.capUsd,
    })),
  };
}
