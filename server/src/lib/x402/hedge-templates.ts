/**
 * Phase 17 (MP-010) — predefined hedge-strategy templates rendered as
 * concrete advisory legs for the paid hedging service.
 *
 * PURE module: no I/O, no store, no engine. The templates speak the B9
 * strategy vocabulary (take-profit-stop B9-002, delta-hedge B9-003) but
 * arm NOTHING — strategy-store.ts and the execution engine stay internal
 * (B9-004 discipline). Each leg is expressed in the trading service's
 * request vocabulary (providerEventId, outcomeIndex, direction, amountRaw)
 * so an agent can feed it verbatim to POST /api/x402/v1/trading/quote or
 * /calldata.
 *
 * Conversions (transparent arithmetic, not engine logic):
 *  - Thresholds always speak the HOME side's YES probability regardless of
 *    which side is held (the B9-002 single-vocabulary rule); for a NO
 *    holder the take-profit and stop levels swap.
 *  - Holding NO on the home market == holding the away market's YES
 *    (outcomeIndex 1), so NO-side legs quote as away-market trades.
 *  - amountRaw (6 dp) derives from the leg's USDC size divided by the
 *    token's assumed price — only when a price is available.
 */

/** One advisory leg — quotable through the paid trading services. */
export interface HedgeLeg {
  label: string;
  providerEventId: string;
  /** 0 = home market, 1 = away market — whose YES the leg trades. */
  outcomeIndex: 0 | 1;
  direction: "buy" | "sell";
  /** Advisory size in USDC — always present. */
  amountUsd: number;
  /**
   * Input size in raw units (6 dp) at the assumed price. Explicitly
   * `| undefined` (exactOptionalPropertyTypes): absent when no price was
   * available — `quotable` is false and callers must not quote the leg.
   */
  amountRaw?: string | undefined;
  /** Fire when the HOME YES probability reaches this (bps); null = act now. */
  triggerBps: number | null;
  note: string;
}

export interface HedgePlan {
  id: string;
  title: string;
  /** The internal B9 vocabulary this template mirrors. */
  mirrors: string;
  whenToUse: string;
  legs: HedgeLeg[];
  /**
   * The internal armed-strategy shape this plan corresponds to, for
   * reference only — Mantua's strategy store is not reachable from here.
   */
  wouldArmAs?: Record<string, unknown>;
  /** False when no assumed price was available and legs carry sizes in USDC only. */
  quotable: boolean;
}

export interface HedgeTemplateInput {
  providerEventId: string;
  /** Which side the caller holds — thresholds and legs flip on this. */
  side: "yes" | "no";
  /** Current exposure in the held side, USDC. */
  exposureUsd: number;
  /** Assumed HOME YES probability in bps; null when no price feed. */
  homePriceBps: number | null;
}

/** Take-profit / stop defaults on the home YES scale (bps). */
const TAKE_PROFIT_BPS = 6500;
const STOP_BPS = 3500;
/** Protective-flip hedge ratio — how much of the exposure to cover. */
const FLIP_RATIO = 0.5;
/** Band-de-risk: distance from the current price to each band edge. */
const BAND_WIDTH_BPS = 2000;
/** Price validity window for raw conversions — a 0/10000 bps price cannot size a leg. */
const PRICE_FLOOR = 0;
const PRICE_CEILING = 1;

/** Round a USDC size to cents — legs are advisory, pennies of noise is fine. */
function roundUsd(amountUsd: number): number {
  return Math.round(amountUsd * 100) / 100;
}

/** Scale a USDC size to raw 6 dp units at a token price; null when unusable. */
function usdcToRaw(amountUsd: number, price: number | null): string | undefined {
  if (price === null || !Number.isFinite(price) || price <= PRICE_FLOOR || price >= PRICE_CEILING) {
    return undefined;
  }
  return String(Math.round((amountUsd / price) * 1_000_000));
}

/** Quotable iff every leg carries a derivable amountRaw. */
function legsQuotable(legs: readonly HedgeLeg[]): boolean {
  return legs.every((l) => l.amountRaw !== undefined);
}

/**
 * The three predefined templates. Order is deliberate: de-risk first (the
 * cheapest to act on), then the flip, then the band.
 */
export function hedgePlans(input: HedgeTemplateInput): HedgePlan[] {
  const { providerEventId, side, exposureUsd, homePriceBps } = input;
  const heldPrice =
    homePriceBps === null ? null : (side === "yes" ? homePriceBps : 10_000 - homePriceBps) / 10_000;
  const flipPrice =
    homePriceBps === null ? null : (side === "yes" ? 10_000 - homePriceBps : homePriceBps) / 10_000;
  const heldOutcomeIndex: 0 | 1 = side === "yes" ? 0 : 1;
  // For a NO holder the home-YES thresholds swap: a NO take-profit IS a
  // home-YES fall (B9-002's conversion rule).
  const takeProfitBps = side === "yes" ? TAKE_PROFIT_BPS : STOP_BPS;
  const stopBps = side === "yes" ? STOP_BPS : TAKE_PROFIT_BPS;

  // ── scale-out — mirrors take-profit-stop (B9-002) ──────────────────────────
  // Sell the held side in three tranches: half now, the rest at take-profit
  // and stop levels on the home YES scale.
  const scaleOutShares = [
    { share: 0.5, triggerBps: null, label: "de-risk half now" },
    { share: 0.3, triggerBps: takeProfitBps, label: "take-profit tranche" },
    { share: 0.2, triggerBps: stopBps, label: "stop tranche" },
  ] as const;
  const scaleOutLegs: HedgeLeg[] = scaleOutShares.map(({ share, triggerBps, label }) => {
    const amountUsd = roundUsd(exposureUsd * share);
    return {
      label,
      providerEventId,
      outcomeIndex: heldOutcomeIndex,
      direction: "sell" as const,
      amountUsd,
      amountRaw: usdcToRaw(amountUsd, heldPrice),
      triggerBps,
      note:
        triggerBps === null
          ? `Sell ${String(Math.round(share * 100))}% of the held ${side.toUpperCase()} exposure at the current price.`
          : `Sell when the HOME YES probability reaches ${String(triggerBps)} bps (held side: ${side.toUpperCase()}).`,
    };
  });

  // ── protective-flip — no internal equivalent ───────────────────────────────
  // Buy the opposite side outright to cap net downside. A manual opposite-
  // side buy is not an armable internal strategy — say so instead of
  // pretending it maps onto the store.
  const flipUsd = roundUsd(exposureUsd * FLIP_RATIO);
  const protectiveFlipLeg: HedgeLeg = {
    label: "buy the opposite side",
    providerEventId,
    outcomeIndex: side === "yes" ? 1 : 0,
    direction: "buy",
    amountUsd: flipUsd,
    amountRaw: usdcToRaw(flipUsd, flipPrice),
    triggerBps: null,
    note: `Buy ${String(Math.round(FLIP_RATIO * 100))}% of the exposure on the opposite side; nets the position toward zero.`,
  };

  // ── band-de-risk — mirrors delta-hedge (B9-003), single-market band form ───
  // Keep exposure inside a price band: shed a quarter when price falls out
  // the bottom, another quarter when it rises out the top. Triggers speak
  // the HOME YES scale for both sides (the single-vocabulary rule).
  const bandLow = homePriceBps === null ? null : Math.max(1000, homePriceBps - BAND_WIDTH_BPS);
  const bandHigh = homePriceBps === null ? null : Math.min(9000, homePriceBps + BAND_WIDTH_BPS);
  const bandShareUsd = roundUsd(exposureUsd * 0.25);
  const bandLegs: HedgeLeg[] = [
    {
      label: "band floor exit",
      providerEventId,
      outcomeIndex: heldOutcomeIndex,
      direction: "sell",
      amountUsd: bandShareUsd,
      amountRaw: usdcToRaw(bandShareUsd, heldPrice),
      triggerBps: bandLow,
      note:
        bandLow === null
          ? "Sell a quarter of the exposure if the HOME YES probability falls out of the band."
          : `Sell a quarter of the exposure if the HOME YES probability falls to/below ${String(bandLow)} bps.`,
    },
    {
      label: "band ceiling trim",
      providerEventId,
      outcomeIndex: heldOutcomeIndex,
      direction: "sell",
      amountUsd: bandShareUsd,
      amountRaw: usdcToRaw(bandShareUsd, heldPrice),
      triggerBps: bandHigh,
      note:
        bandHigh === null
          ? "Sell a quarter of the exposure if the HOME YES probability rises out of the band."
          : `Sell a quarter of the exposure if the HOME YES probability rises to/above ${String(bandHigh)} bps.`,
    },
  ];

  return [
    {
      id: "scale-out",
      title: "Scale-out tranches",
      mirrors: "take-profit-stop (B9-002)",
      whenToUse: "De-risk a held position in tranches instead of all at once.",
      legs: scaleOutLegs,
      wouldArmAs: {
        kind: "take-profit-stop",
        side,
        takeProfitBps,
        stopBps,
        note: "The internal shape also carries the on-chain market id; this service arms nothing (B9-004).",
      },
      quotable: legsQuotable(scaleOutLegs),
    },
    {
      id: "protective-flip",
      title: "Protective flip",
      mirrors: "none — a manual opposite-side buy (delta vocabulary)",
      whenToUse:
        "Cap net downside without selling the winning position (keeps upside, costs premium).",
      legs: [protectiveFlipLeg],
      quotable: legsQuotable([protectiveFlipLeg]),
    },
    {
      id: "band-de-risk",
      title: "Band de-risk",
      mirrors: "delta-hedge (B9-003) — single-market band form",
      whenToUse: "Keep exposure inside a probability band; shed tranches at the edges.",
      legs: bandLegs,
      wouldArmAs: {
        kind: "delta-hedge",
        marketIds: [],
        targetNetUsd: 0,
        bandUsd: bandShareUsd,
        note: "The internal shape hedges across 2-8 markets with real net exposure; this single-market band form is advisory only.",
      },
      quotable: legsQuotable(bandLegs),
    },
  ];
}
