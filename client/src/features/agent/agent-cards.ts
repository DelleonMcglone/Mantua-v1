/**
 * Phase 8 / A-002, A-014, A-043 — pure adapters from the server's agent tool
 * results to the rows the chat cards render. Kept free of React so the
 * shaping is unit-tested; `CircleAgentChat.tsx` only lays the rows out.
 */

export interface SimulationResult {
  executable: boolean;
  blockers: string[];
  direction: "buy" | "sell";
  amountRaw: string;
  providerEventId: string;
  outcomeIndex: 0 | 1;
  market: { tradability: string; league: string | null; impliedProbabilityBps: number | null };
  estimate: {
    amountIn: string;
    amountOut: string;
    amountOutMinimum: string;
    effectivePriceBps: number | null;
    priceImpactBps: number | null;
  } | null;
  fees: { feeUsdcRaw: string; feePips: number; playoffs: boolean } | null;
  position: { afterRaw: string; exposureUsd: number | null };
  walletPolicy: { ok: boolean; reason: string | null; remainingTodayUsd: number };
  marketPolicy: { ok: boolean; reason: string | null };
}

export interface CardRow {
  label: string;
  value: string;
}

const usd6 = (raw: string): number => Number(raw) / 1e6;
const pct = (bps: number | null): string => (bps === null ? "—" : `${(bps / 100).toFixed(1)}%`);
const money = (n: number): string => `$${n.toFixed(2)}`;

/** The preview card: title, rows, and whether Confirm may be offered. */
export function simulationCard(sim: SimulationResult): {
  title: string;
  rows: CardRow[];
  blockers: string[];
  canConfirm: boolean;
} {
  const amount = usd6(sim.amountRaw);
  const side = sim.outcomeIndex === 0 ? "home" : "away";
  const title =
    sim.direction === "buy"
      ? `Buy ${money(amount)} of ${side} YES`
      : `Sell ${amount.toFixed(2)} ${side} YES`;
  const rows: CardRow[] = [];
  if (sim.estimate) {
    rows.push({
      label: sim.direction === "buy" ? "You receive" : "You get back",
      value:
        sim.direction === "buy"
          ? `~${usd6(sim.estimate.amountOut).toFixed(2)} YES (min ${usd6(sim.estimate.amountOutMinimum).toFixed(2)})`
          : `~${money(usd6(sim.estimate.amountOut))} (min ${money(usd6(sim.estimate.amountOutMinimum))})`,
    });
    rows.push({
      label: "Effective price",
      value: `${pct(sim.estimate.effectivePriceBps)}${
        sim.market.impliedProbabilityBps === null
          ? ""
          : ` (market ${pct(sim.market.impliedProbabilityBps)})`
      }`,
    });
    if (sim.estimate.priceImpactBps !== null) {
      rows.push({
        label: "Price impact",
        value: `${(sim.estimate.priceImpactBps / 100).toFixed(2)}%`,
      });
    }
  }
  if (sim.fees) {
    rows.push({
      label: "Hook fee",
      value: `${money(usd6(sim.fees.feeUsdcRaw))}${sim.fees.playoffs ? " (playoffs)" : ""}`,
    });
  }
  rows.push({
    label: "Position after",
    value: `${usd6(sim.position.afterRaw).toFixed(2)} YES${
      sim.position.exposureUsd === null ? "" : ` · ${money(sim.position.exposureUsd)} at stake`
    }`,
  });
  rows.push({ label: "Cap remaining today", value: money(sim.walletPolicy.remainingTodayUsd) });
  return { title, rows, blockers: sim.blockers, canConfirm: sim.executable };
}

export interface AnalysisResult {
  team: string;
  opponent: string;
  side: "home" | "away";
  market: { impliedProbabilityBps: number | null; liquidityUsdc: number | null } | null;
  analysis: {
    probabilityBps: number;
    discrepancyBps: number | null;
    confidence: string;
    evidence: { factor: string; detail: string; effectBps: number }[];
    riskFactors: string[];
    suggestedAction: { kind: string; rationale: string };
  };
}

export function analysisCard(a: AnalysisResult): {
  title: string;
  headline: string;
  evidence: CardRow[];
  risks: string[];
  action: string;
} {
  const market = a.market?.impliedProbabilityBps ?? null;
  const headline = `Estimate ${pct(a.analysis.probabilityBps)} · market ${pct(market)}${
    a.analysis.discrepancyBps === null
      ? ""
      : ` · ${a.analysis.discrepancyBps > 0 ? "+" : ""}${(a.analysis.discrepancyBps / 100).toFixed(1)} pts`
  } · ${a.analysis.confidence} confidence`;
  const action =
    a.analysis.suggestedAction.kind === "consider_buy_yes"
      ? "Looks cheap — consider buying YES"
      : a.analysis.suggestedAction.kind === "consider_fade"
        ? "Looks rich — consider the other side"
        : a.analysis.suggestedAction.kind === "no_market_price"
          ? "No market price yet"
          : "No edge — hold";
  return {
    title: `${a.team} vs ${a.opponent} (${a.side})`,
    headline,
    evidence: a.analysis.evidence.map((e) => ({
      label: e.factor,
      value: `${e.effectBps > 0 ? "+" : ""}${(e.effectBps / 100).toFixed(1)} · ${e.detail}`,
    })),
    risks: a.analysis.riskFactors,
    action,
  };
}

export interface DailyBriefResult {
  wallet: {
    usdcBalance: number;
    dailyCapUsd: number;
    spentTodayUsd: number;
    remainingTodayUsd: number;
  };
  positions: { count: number; valueUsd: number; pnlUsd: number };
  performance: { realizedPnlUsd: number; winRate: number | null; wins: number; losses: number };
  policy: { status: string; maxStakePerTradeUsd: number } | null;
  markets: {
    live: { matchup: string; homeWinProbabilityBps: number | null; status: string }[];
    upcoming: { matchup: string; homeWinProbabilityBps: number | null; startsAt: string }[];
  };
}

export function dailyBriefCard(b: DailyBriefResult): {
  rows: CardRow[];
  markets: CardRow[];
} {
  const rows: CardRow[] = [
    {
      label: "Agent wallet",
      value: `${money(b.wallet.usdcBalance)} USDC · ${money(b.wallet.remainingTodayUsd)} of ${money(b.wallet.dailyCapUsd)} cap left today`,
    },
    {
      label: "Open positions",
      value: `${String(b.positions.count)} · ${money(b.positions.valueUsd)} · P&L ${b.positions.pnlUsd >= 0 ? "+" : ""}${money(b.positions.pnlUsd)}`,
    },
    {
      label: "Track record",
      value: `${b.performance.realizedPnlUsd >= 0 ? "+" : ""}${money(b.performance.realizedPnlUsd)} realized · ${
        b.performance.winRate === null
          ? "no resolved markets yet"
          : `${(b.performance.winRate * 100).toFixed(0)}% win rate (${String(b.performance.wins)}-${String(b.performance.losses)})`
      }`,
    },
  ];
  if (b.policy) {
    rows.push({
      label: "Policy",
      value: `${b.policy.status} · max ${money(b.policy.maxStakePerTradeUsd)} per trade`,
    });
  }
  const markets: CardRow[] = [
    ...b.markets.live.map((m) => ({
      label: "LIVE",
      value: `${m.matchup} · home ${pct(m.homeWinProbabilityBps)}`,
    })),
    ...b.markets.upcoming.map((m) => ({
      label: new Date(m.startsAt).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
      value: `${m.matchup} · home ${pct(m.homeWinProbabilityBps)}`,
    })),
  ];
  return { rows, markets };
}
