/**
 * Phase 9 / PF-002, PF-007, PF-009 — the economics of one liquidity
 * position: what was deposited (USD at deposit time, from the ledger rows
 * the add-liquidity routes wrote), what it is worth now (the on-chain
 * amounts at the live price), the fees it has accrued, the resulting P&L,
 * and the position's share of its pool when the pool's total liquidity is
 * known. Pure over inputs; `routes/portfolio-economics.ts` feeds it.
 *
 * Honesty rules: deposited is null (not zero) when no ledger row carries
 * the position's tokenId — a position discovered on-chain that Mantua did
 * not open has no basis, and the UI says so rather than showing 100 %
 * profit. Share is null without pool liquidity.
 */

export interface LpPositionInput {
  tokenId: string;
  tokenA: string;
  tokenB: string;
  /** Human-formatted current amounts (as `readOnchainPositions` returns). */
  amountA: string;
  amountB: string;
  liquidity: string;
  hook: string | null;
  fee: number;
}

export interface LpBasis {
  /** Σ usd_value of the add-liquidity ledger rows for this tokenId. */
  depositedUsd: number;
  /** Earliest add. */
  firstAddAt: string | null;
  adds: number;
}

export interface LpEconomics {
  tokenId: string;
  pair: string;
  hook: string | null;
  fee: number;
  amountA: string;
  amountB: string;
  currentValueUsd: number;
  accruedFeesUsd: number;
  depositedUsd: number | null;
  /** current + accrued − deposited; null without a basis. */
  pnlUsd: number | null;
  pnlPct: number | null;
  /** Position liquidity / pool liquidity, bps; null when unknown. */
  liquidityShareBps: number | null;
  since: string | null;
}

const round2 = (n: number): number => Number(n.toFixed(2));

export function computeLpEconomics(
  position: LpPositionInput,
  prices: { a: number; b: number },
  basis: LpBasis | null,
  accruedFeesUsd: number,
  poolLiquidity: bigint | null,
): LpEconomics {
  const valueA = Number(position.amountA) * prices.a;
  const valueB = Number(position.amountB) * prices.b;
  const currentValueUsd = round2(
    (Number.isFinite(valueA) ? valueA : 0) + (Number.isFinite(valueB) ? valueB : 0),
  );
  const accrued = round2(Number.isFinite(accruedFeesUsd) ? accruedFeesUsd : 0);
  const deposited = basis && basis.depositedUsd > 0 ? round2(basis.depositedUsd) : null;
  const pnlUsd = deposited === null ? null : round2(currentValueUsd + accrued - deposited);
  const pnlPct =
    deposited === null || pnlUsd === null ? null : Number(((pnlUsd / deposited) * 100).toFixed(2));
  let liquidityShareBps: number | null = null;
  if (poolLiquidity !== null && poolLiquidity > 0n) {
    const own = BigInt(position.liquidity);
    liquidityShareBps = Number((own * 10_000n) / poolLiquidity);
    if (liquidityShareBps > 10_000) liquidityShareBps = 10_000;
  }
  return {
    tokenId: position.tokenId,
    pair: `${position.tokenA}/${position.tokenB}`,
    hook: position.hook,
    fee: position.fee,
    amountA: position.amountA,
    amountB: position.amountB,
    currentValueUsd,
    accruedFeesUsd: accrued,
    depositedUsd: deposited,
    pnlUsd,
    pnlPct,
    liquidityShareBps,
    since: basis?.firstAddAt ?? null,
  };
}

export interface LpTotals {
  positions: number;
  currentValueUsd: number;
  accruedFeesUsd: number;
  /** Over positions with a basis only. */
  depositedUsd: number;
  pnlUsd: number;
  withoutBasis: number;
}

export function totalLpEconomics(rows: readonly LpEconomics[]): LpTotals {
  let value = 0;
  let fees = 0;
  let deposited = 0;
  let pnl = 0;
  let withoutBasis = 0;
  for (const r of rows) {
    value += r.currentValueUsd;
    fees += r.accruedFeesUsd;
    if (r.depositedUsd === null || r.pnlUsd === null) {
      withoutBasis += 1;
      continue;
    }
    deposited += r.depositedUsd;
    pnl += r.pnlUsd;
  }
  return {
    positions: rows.length,
    currentValueUsd: round2(value),
    accruedFeesUsd: round2(fees),
    depositedUsd: round2(deposited),
    pnlUsd: round2(pnl),
    withoutBasis,
  };
}

/** Pure: fold the add-liquidity ledger rows into a basis per tokenId. */
export function basisFromLedger(
  rows: readonly { params: unknown; usdValue: string | null; createdAt: Date }[],
): Map<string, LpBasis> {
  const out = new Map<string, LpBasis>();
  for (const r of rows) {
    const p = r.params && typeof r.params === "object" ? (r.params as Record<string, unknown>) : {};
    const tokenId = typeof p["tokenId"] === "string" ? p["tokenId"] : null;
    if (!tokenId) continue;
    const usd = r.usdValue === null ? 0 : Number(r.usdValue);
    const prev = out.get(tokenId);
    const at = r.createdAt.toISOString();
    out.set(tokenId, {
      depositedUsd: (prev?.depositedUsd ?? 0) + (Number.isFinite(usd) ? usd : 0),
      firstAddAt: prev?.firstAddAt && prev.firstAddAt < at ? prev.firstAddAt : at,
      adds: (prev?.adds ?? 0) + 1,
    });
  }
  return out;
}
