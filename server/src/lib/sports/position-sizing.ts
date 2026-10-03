/**
 * Prompt 4 — "I want to risk $100 on this trade." The arithmetic of a
 * YES/NO position at a given entry price, as pure functions: contracts for
 * the risk, the bounded loss and profit, and what the position is worth if
 * the price moves by set percentages either way. A contract pays 1 USDC on
 * a win and 0 on a loss, so the numbers are exact given the entry price.
 */
export const SCENARIO_MOVES = [5, 10, 20] as const;

export interface PositionSizing {
  riskUsdc: number;
  entryPriceBps: number;
  entryPrice: number;
  contracts: number;
  maxLossUsdc: number;
  maxProfitUsdc: number;
  breakevenWinProbabilityBps: number;
  /** A take-profit price that banks half the remaining upside. */
  takeProfitBps: number;
  scenarios: { move: string; priceBps: number; valueUsdc: number; pnlUsdc: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clampBps = (n: number) => Math.min(9_999, Math.max(1, Math.round(n)));

export function sizePosition(riskUsdc: number, entryPriceBps: number): PositionSizing {
  if (!(riskUsdc > 0)) throw new Error("riskUsdc must be positive");
  const entryPrice = clampBps(entryPriceBps) / 10_000;
  const contracts = riskUsdc / entryPrice;
  // Worst case first: −20, −10, −5, +5, +10, +20.
  const moves = [...[...SCENARIO_MOVES].reverse().map((m) => -m), ...SCENARIO_MOVES];
  const scenarios = moves.map((pct) => {
    const priceBps = clampBps(entryPriceBps * (1 + pct / 100));
    const valueUsdc = round2((contracts * priceBps) / 10_000);
    return {
      move: `${pct > 0 ? "+" : ""}${String(pct)}%`,
      priceBps,
      valueUsdc,
      pnlUsdc: round2(valueUsdc - riskUsdc),
    };
  });
  return {
    riskUsdc: round2(riskUsdc),
    entryPriceBps: clampBps(entryPriceBps),
    entryPrice: round2(entryPrice),
    contracts: round2(contracts),
    maxLossUsdc: round2(riskUsdc),
    maxProfitUsdc: round2(contracts - riskUsdc),
    breakevenWinProbabilityBps: clampBps(entryPriceBps),
    takeProfitBps: clampBps(entryPriceBps + (10_000 - entryPriceBps) / 2),
    scenarios,
  };
}
