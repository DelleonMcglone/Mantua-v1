/**
 * A basket: several independent market buys the user approves once
 * (Coinbase for Agents' "Order preview · $X basket", owner 2026-10-03).
 *
 * Not a combo — a combo is one parlay ticket that pays only if every leg
 * wins; a basket is N separate positions. Each leg is simulated with the
 * single-trade builder, the whole set is saved as one `action` preview,
 * and on the user's confirm the legs execute one by one. A leg that fails
 * does not stop the others, and the totals count only what filled.
 */
import { z } from "zod";

export const MAX_LEGS = 8;

export const basketLegInput = z.object({
  providerEventId: z.string().regex(/^\d{1,32}$/),
  outcomeIndex: z.union([z.literal(0), z.literal(1)]),
  /** USDC to spend on this leg, decimal. */
  amount: z.number().positive().max(10_000),
  /** Shown on the card; the server never trusts it for identity. */
  label: z.string().trim().min(1).max(80).optional(),
});
export type BasketLegInput = z.infer<typeof basketLegInput>;

export const basketInput = z.object({
  legs: z.array(basketLegInput).min(1).max(MAX_LEGS),
  /** The budget the user stated; the legs must fit inside it. */
  budgetUsdc: z.number().positive().max(10_000).optional(),
});

/** Round to the 6-decimal USDC grid and total the legs. */
export function planBasket(raw: unknown): {
  legs: BasketLegInput[];
  totalUsdc: number;
  budgetUsdc: number | null;
} {
  const input = basketInput.parse(raw);
  const legs = input.legs.map((l) => ({ ...l, amount: Math.round(l.amount * 1e6) / 1e6 }));
  const totalUsdc = Math.round(legs.reduce((s, l) => s + l.amount, 0) * 1e6) / 1e6;
  const budgetUsdc = input.budgetUsdc ?? null;
  if (budgetUsdc !== null && totalUsdc > budgetUsdc + 1e-6) {
    throw new Error(
      `The legs total ${totalUsdc.toFixed(2)} USDC, over the ${budgetUsdc.toFixed(2)} USDC budget. Reduce a leg or raise the budget.`,
    );
  }
  const seen = new Set<string>();
  for (const l of legs) {
    const key = `${l.providerEventId}:${String(l.outcomeIndex)}`;
    if (seen.has(key)) throw new Error(`Two legs name the same market (${key}); merge them.`);
    seen.add(key);
  }
  return { legs, totalUsdc, budgetUsdc };
}

/** The execution arguments the preview hash covers: identity + amount only. */
export function basketExecutionArgs(legs: readonly BasketLegInput[]): Record<string, unknown> {
  return {
    legs: legs.map((l) => ({
      providerEventId: l.providerEventId,
      outcomeIndex: l.outcomeIndex,
      amount: l.amount,
    })),
  };
}

export interface LegFill {
  providerEventId: string;
  outcomeIndex: 0 | 1;
  label: string | null;
  amountUsdc: number;
  status: "filled" | "failed";
  txHash: string | null;
  received: string | null;
  effectivePriceBps: number | null;
  error: string | null;
}

export interface BasketOutcome {
  legs: LegFill[];
  requestedUsdc: number;
  placedUsdc: number;
  /** Budget − placed when a budget was stated, else requested − placed. */
  leftoverUsdc: number;
  filled: number;
  failed: number;
}

/** Totals over the fills; pure. */
export function summarizeFills(legs: readonly LegFill[], budgetUsdc: number | null): BasketOutcome {
  const requestedUsdc = round(legs.reduce((s, l) => s + l.amountUsdc, 0));
  const placedUsdc = round(
    legs.filter((l) => l.status === "filled").reduce((s, l) => s + l.amountUsdc, 0),
  );
  const base = budgetUsdc ?? requestedUsdc;
  return {
    legs: [...legs],
    requestedUsdc,
    placedUsdc,
    leftoverUsdc: round(Math.max(0, base - placedUsdc)),
    filled: legs.filter((l) => l.status === "filled").length,
    failed: legs.filter((l) => l.status === "failed").length,
  };
}

/** Run the legs in order; one failure never stops the rest. */
export async function executeBasket(
  legs: readonly BasketLegInput[],
  budgetUsdc: number | null,
  runLeg: (
    leg: BasketLegInput,
  ) => Promise<
    Omit<LegFill, "providerEventId" | "outcomeIndex" | "label" | "amountUsdc" | "status" | "error">
  >,
): Promise<BasketOutcome> {
  const fills: LegFill[] = [];
  for (const leg of legs) {
    const base = {
      providerEventId: leg.providerEventId,
      outcomeIndex: leg.outcomeIndex,
      label: leg.label ?? null,
      amountUsdc: leg.amount,
    };
    try {
      const r = await runLeg(leg);
      fills.push({ ...base, ...r, status: "filled", error: null });
    } catch (err) {
      fills.push({
        ...base,
        status: "failed",
        txHash: null,
        received: null,
        effectivePriceBps: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summarizeFills(fills, budgetUsdc);
}

const round = (n: number) => Math.round(n * 100) / 100;
