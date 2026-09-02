import { listBasePools, getTokenPrices, getTokenChangePercents } from "./defillama.ts";
import { getPythPrices, PYTH_EUR_USD_FEED_ID } from "./pyth-prices.ts";
import { getCoinbaseMarket, getCoinbaseSpot } from "./coinbase.ts";
import { logger } from "./logger.ts";
import { buildPoolKey } from "./pool-key.ts";
import { readSlot0 } from "./v4-state-view.ts";
import { getHookAddress, type FeeTier, type HookName } from "./v4-contracts.ts";
import { getToken, type TokenSymbol } from "./tokens.ts";
import { z } from "zod";

/**
 * POC analyze engine. Each topic is a one-shot fetcher that turns
 * external data (DefiLlama Coins for spot/change, DefiLlama Yields for
 * pool stats, plus a sprinkling of static content for the educational
 * topic) into a generic `AnalyzeResponse` so the client can render it
 * without per-topic branching. Bigger plans (full agentic research,
 * charts, etc.) live downstream — this is the "answer the suggestion
 * buttons with real data" pass the user explicitly asked for.
 *
 * Spot prices route through DefiLlama Coins (`coins.llama.fi`) — the
 * free tier is open and rate-limit-friendly, vs. CoinGecko's anonymous
 * free tier which throttles at ~5–15 req/min per source IP. DefiLlama
 * keys the same prices we want by `coingecko:<id>`, so the existing
 * alias map drives both sources.
 */

export const TOPICS = [
  "eth-price",
  "cbbtc-price",
  "eurc-peg",
  "usdc-eurc-pool",
  "top-stablecoins",
  "cbbtc-24h-volume",
  "usdc-24h-volume",
  "market-summary",
  "base-pools",
  // Coinbase read-only public market data (no auth) for the three assets.
  "coinbase-prices",
  "mantua-hooks",
  // Generic price lookup — uses the `?symbol=` query param (or the
  // `symbol` body field) to drive a CoinGecko spot fetch. Falls back
  // to a "we don't know that symbol" message when the symbol isn't in
  // our small alias map.
  "token-price",
] as const;
export type Topic = (typeof TOPICS)[number];
export const topicSchema = z.enum(TOPICS);

/**
 * Map common natural-language token names to CoinGecko ids and
 * display labels. Kept as a flat array (not a record) so the order
 * of matching is deterministic — longer aliases first to avoid
 * "btc" cannibalizing "cbbtc" before the cb prefix is checked.
 */
const TOKEN_ALIASES: { aliases: string[]; coingeckoId: string; label: string; symbol: string }[] = [
  {
    aliases: ["coinbase wrapped btc", "cbbtc", "cb-btc"],
    coingeckoId: "coinbase-wrapped-btc",
    label: "Coinbase Wrapped BTC",
    symbol: "cbBTC",
  },
  { aliases: ["bitcoin", "btc"], coingeckoId: "bitcoin", label: "Bitcoin", symbol: "BTC" },
  { aliases: ["ethereum", "eth"], coingeckoId: "ethereum", label: "Ethereum", symbol: "ETH" },
  { aliases: ["solana", "sol"], coingeckoId: "solana", label: "Solana", symbol: "SOL" },
  { aliases: ["usd coin", "usdc"], coingeckoId: "usd-coin", label: "USD Coin", symbol: "USDC" },
  { aliases: ["tether", "usdt"], coingeckoId: "tether", label: "Tether", symbol: "USDT" },
  { aliases: ["euro coin", "eurc"], coingeckoId: "euro-coin", label: "Euro Coin", symbol: "EURC" },
  {
    aliases: ["wrapped ether", "weth"],
    coingeckoId: "weth",
    label: "Wrapped Ether",
    symbol: "WETH",
  },
  { aliases: ["maker", "mkr"], coingeckoId: "maker", label: "Maker", symbol: "MKR" },
  { aliases: ["pendle"], coingeckoId: "pendle", label: "Pendle", symbol: "PENDLE" },
  { aliases: ["ondo"], coingeckoId: "ondo-finance", label: "Ondo", symbol: "ONDO" },
  { aliases: ["centrifuge", "rwa"], coingeckoId: "centrifuge", label: "Centrifuge", symbol: "CFG" },
];

export function resolveTokenAlias(
  input: string,
): { coingeckoId: string; label: string; symbol: string } | null {
  const norm = input.trim().toLowerCase();
  if (!norm) return null;
  for (const t of TOKEN_ALIASES) {
    if (t.aliases.includes(norm)) return t;
  }
  return null;
}

export interface AnalyzeMetric {
  label: string;
  value: string;
  hint?: string;
}

export interface AnalyzeSource {
  name: string;
  url?: string;
}

export interface AnalyzeResponse {
  topic: Topic;
  title: string;
  summary: string;
  metrics?: AnalyzeMetric[];
  bullets?: string[];
  sources?: AnalyzeSource[];
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function fmtPct(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(dp)}%`;
}

async function ethPrice(): Promise<AnalyzeResponse> {
  const [prices, changes] = await Promise.all([
    getTokenPrices(["coingecko:ethereum"]),
    getTokenChangePercents(["coingecko:ethereum"]),
  ]);
  const price = prices["coingecko:ethereum"]?.price;
  if (price === undefined) throw new Error("DefiLlama: ETH price unavailable");
  const change = changes["coingecko:ethereum"] ?? 0;
  return {
    topic: "eth-price",
    title: "ETH spot price",
    summary: `Ethereum is trading at ${fmtUsd(price)} per ETH${
      Number.isFinite(change) ? `, ${fmtPct(change)} in the last 24h` : ""
    }.`,
    metrics: [
      { label: "Price", value: fmtUsd(price) },
      { label: "24h change", value: fmtPct(change) },
    ],
    sources: [{ name: "DefiLlama", url: "https://defillama.com/coins/coingecko:ethereum" }],
  };
}

async function eurcPeg(): Promise<AnalyzeResponse> {
  // Pyth-first: EURC/USD crossed against the FX.EUR/USD feed — the same
  // EUR reference Stable Protection and the agent signals use (peg-sync.ts,
  // agent-signals.ts).
  //   peg_ratio  = EURC_usd / EUR_ref_usd   (should be ≈ 1.0 on-peg)
  //   deviation% = (peg_ratio - 1) * 100
  // When Hermes can't serve either feed, fall back to the DefiLlama agEUR
  // cross: DefiLlama quotes USD only (no `vs_currency=eur`), so agEUR —
  // another EUR-pegged stablecoin — stands in as the EUR reference. That
  // makes the fallback noisier (agEUR has its own soft-peg wobble).
  // Tether-EURT was rejected as a reference (price ≈ $0.07, broken).
  const eurcFeedId = getToken("EURC").pythFeedId;
  let eurcUsd: number | undefined;
  let eurRef: number | undefined;
  let refLabel = "Pyth FX.EUR/USD";
  let sources: AnalyzeSource[] = [
    { name: "Pyth (EURC/USD)", url: "https://app.pyth.com/explore/crypto-eurc-usd" },
    { name: "Pyth (FX.EUR/USD)", url: "https://app.pyth.com/explore/fx-eur-usd" },
    { name: "Circle EURC", url: "https://www.circle.com/eurc" },
  ];
  if (eurcFeedId) {
    const pyth = await getPythPrices([eurcFeedId, PYTH_EUR_USD_FEED_ID]);
    eurcUsd = pyth[eurcFeedId];
    eurRef = pyth[PYTH_EUR_USD_FEED_ID];
  }
  if (eurcUsd === undefined || eurRef === undefined || eurRef === 0) {
    const prices = await getTokenPrices(["coingecko:euro-coin", "coingecko:ageur"]);
    eurcUsd = prices["coingecko:euro-coin"]?.price;
    eurRef = prices["coingecko:ageur"]?.price;
    refLabel = "DefiLlama agEUR fallback";
    sources = [
      { name: "DefiLlama (EURC)", url: "https://defillama.com/coins/coingecko:euro-coin" },
      { name: "DefiLlama (agEUR)", url: "https://defillama.com/coins/coingecko:ageur" },
      { name: "Circle EURC", url: "https://www.circle.com/eurc" },
    ];
    if (eurcUsd === undefined || eurRef === undefined || eurRef === 0) {
      throw new Error("EURC peg: Pyth and DefiLlama price sources both unavailable");
    }
  }
  const pegRatio = eurcUsd / eurRef;
  const dev = (pegRatio - 1) * 100;
  let zone: "ON_PEG" | "WARN" | "STRESS";
  if (Math.abs(dev) < 0.5) zone = "ON_PEG";
  else if (Math.abs(dev) < 2) zone = "WARN";
  else zone = "STRESS";
  return {
    topic: "eurc-peg",
    title: "EURC peg status",
    summary:
      zone === "ON_PEG"
        ? `EURC is trading at $${eurcUsd.toFixed(4)} vs the EUR reference of $${eurRef.toFixed(4)} (${refLabel}). Within ±0.5% of the 1:1 EUR peg.`
        : zone === "WARN"
          ? `EURC at $${eurcUsd.toFixed(4)} vs EUR reference $${eurRef.toFixed(4)} (${refLabel}) — peg ratio ${pegRatio.toFixed(4)} (${fmtPct(dev)} off). Slightly outside the tight ±0.5% band.`
          : `EURC at $${eurcUsd.toFixed(4)} vs EUR reference $${eurRef.toFixed(4)} (${refLabel}) — peg ratio ${pegRatio.toFixed(4)} (${fmtPct(dev)} off). Outside the ±2% band; Stable Protection would flag STRESS.`,
    metrics: [
      { label: "EURC (USD)", value: `$${eurcUsd.toFixed(4)}` },
      { label: "EUR reference", value: `$${eurRef.toFixed(4)}`, hint: refLabel },
      { label: "Implied peg", value: pegRatio.toFixed(4) },
      { label: "Peg deviation", value: fmtPct(dev) },
      { label: "Zone", value: zone },
    ],
    sources,
  };
}

async function usdcEurcPool(): Promise<AnalyzeResponse> {
  const all = await listBasePools();
  const candidates = all.filter((p) => /USDC.*EURC|EURC.*USDC/i.test(p.symbol));
  if (candidates.length === 0) {
    return {
      topic: "usdc-eurc-pool",
      title: "USDC/EURC pool health",
      summary:
        "DefiLlama doesn't currently surface a USDC/EURC pool on Base. The USD/EUR stablecoin cross is thin onchain today; on Mantua it's the canonical pair for the Stable Protection hook, which keeps the pool from draining when either leg drifts off peg.",
      sources: [{ name: "DefiLlama (Base pools)", url: "https://defillama.com/yields?chain=Base" }],
    };
  }
  const top = candidates.sort((a, b) => b.tvlUsd - a.tvlUsd)[0];
  return {
    topic: "usdc-eurc-pool",
    title: "USDC/EURC — top Base pool",
    summary: `The deepest USDC/EURC pool on Base sits in ${top.project} with ${fmtUsd(top.tvlUsd)} TVL${
      top.poolMeta ? ` (fee tier ${top.poolMeta})` : ""
    }. ${
      top.apy && top.apy > 0
        ? `Current APY is ~${top.apy.toFixed(2)}%.`
        : "Yield is currently negligible (mostly volume-driven)."
    }`,
    metrics: [
      { label: "Project", value: top.project },
      { label: "TVL", value: fmtUsd(top.tvlUsd) },
      { label: "Volume (24h)", value: fmtUsd(top.volumeUsd1d ?? 0) },
      { label: "APY", value: top.apy ? `${top.apy.toFixed(2)}%` : "—" },
    ],
    sources: [{ name: "DefiLlama", url: `https://defillama.com/yields/pool/${top.pool}` }],
  };
}

async function cbbtc24hVolume(): Promise<AnalyzeResponse> {
  const all = await listBasePools();
  const cbbtcPools = all.filter((p) => /cbBTC/i.test(p.symbol));
  if (cbbtcPools.length === 0) {
    return {
      topic: "cbbtc-24h-volume",
      title: "cbBTC volume on Base",
      summary:
        "DefiLlama doesn't currently surface cbBTC pools on Base. cbBTC was minted on Base in 2024; once liquidity migrates onto v3/v4 pools the route returns real numbers here.",
      sources: [{ name: "DefiLlama (Base pools)", url: "https://defillama.com/yields?chain=Base" }],
    };
  }
  const total24h = cbbtcPools.reduce((s, p) => s + (p.volumeUsd1d ?? 0), 0);
  const total7d = cbbtcPools.reduce((s, p) => s + (p.volumeUsd7d ?? 0), 0);
  const avgDaily7d = total7d / 7;
  const trend = avgDaily7d > 0 ? ((total24h - avgDaily7d) / avgDaily7d) * 100 : 0;
  const top = cbbtcPools.sort((a, b) => (b.volumeUsd1d ?? 0) - (a.volumeUsd1d ?? 0))[0];
  return {
    topic: "cbbtc-24h-volume",
    title: "cbBTC — 24h volume on Base",
    summary: `Across ${String(cbbtcPools.length)} cbBTC pools on Base, ${fmtUsd(total24h)} of volume cleared in the last 24h${
      Number.isFinite(trend) ? ` (${fmtPct(trend)} vs the trailing 7-day daily average)` : ""
    }. Largest single pool: ${top.project} ${top.symbol} at ${fmtUsd(top.volumeUsd1d ?? 0)}.`,
    metrics: [
      { label: "24h volume (total)", value: fmtUsd(total24h) },
      { label: "7d daily avg", value: fmtUsd(avgDaily7d) },
      { label: "Trend vs 7d avg", value: fmtPct(trend) },
      { label: "Top pool", value: `${top.project} (${fmtUsd(top.volumeUsd1d ?? 0)})` },
    ],
    sources: [
      {
        name: "DefiLlama (Base cbBTC pools)",
        url: "https://defillama.com/yields?chain=Base&token=CBBTC",
      },
    ],
  };
}

async function cbbtcPrice(): Promise<AnalyzeResponse> {
  // cbBTC (Coinbase Wrapped BTC) tracks Bitcoin — evaluate it at the BTC spot.
  const [prices, changes] = await Promise.all([
    getTokenPrices(["coingecko:bitcoin"]),
    getTokenChangePercents(["coingecko:bitcoin"]),
  ]);
  const price = prices["coingecko:bitcoin"]?.price;
  if (price === undefined) throw new Error("DefiLlama: BTC price unavailable");
  const change = changes["coingecko:bitcoin"] ?? 0;
  return {
    topic: "cbbtc-price",
    title: "cbBTC spot price",
    summary: `cbBTC (Coinbase Wrapped BTC) is evaluated at the Bitcoin spot — ${fmtUsd(price)} per cbBTC${
      Number.isFinite(change) ? `, ${fmtPct(change)} in the last 24h` : ""
    }.`,
    metrics: [
      { label: "Price (≈ BTC)", value: fmtUsd(price) },
      { label: "24h change", value: fmtPct(change) },
    ],
    sources: [{ name: "DefiLlama", url: "https://defillama.com/coins/coingecko:bitcoin" }],
  };
}

async function usdc24hVolume(): Promise<AnalyzeResponse> {
  const all = await listBasePools();
  const usdcPools = all.filter((p) => /USDC/i.test(p.symbol));
  if (usdcPools.length === 0) {
    return {
      topic: "usdc-24h-volume",
      title: "USDC 24h volume",
      summary: "DefiLlama doesn't currently surface USDC pool volume for this view.",
      sources: [{ name: "DefiLlama (Base pools)", url: "https://defillama.com/yields?chain=Base" }],
    };
  }
  const total24h = usdcPools.reduce((s, p) => s + (p.volumeUsd1d ?? 0), 0);
  const total7d = usdcPools.reduce((s, p) => s + (p.volumeUsd7d ?? 0), 0);
  const avgDaily7d = total7d / 7;
  const trend = avgDaily7d > 0 ? ((total24h - avgDaily7d) / avgDaily7d) * 100 : 0;
  const top = usdcPools.sort((a, b) => (b.volumeUsd1d ?? 0) - (a.volumeUsd1d ?? 0))[0];
  return {
    topic: "usdc-24h-volume",
    title: "USDC — 24h volume on Base",
    summary: `Across ${String(usdcPools.length)} USDC pools on Base, ${fmtUsd(total24h)} of volume cleared in the last 24h${
      Number.isFinite(trend) ? ` (${fmtPct(trend)} vs the trailing 7-day daily average)` : ""
    }. Largest single pool: ${top.project} ${top.symbol} at ${fmtUsd(top.volumeUsd1d ?? 0)}.`,
    metrics: [
      { label: "24h volume (total)", value: fmtUsd(total24h) },
      { label: "7d daily avg", value: fmtUsd(avgDaily7d) },
      { label: "Trend vs 7d avg", value: fmtPct(trend) },
      { label: "Top pool", value: `${top.project} (${fmtUsd(top.volumeUsd1d ?? 0)})` },
    ],
    sources: [
      {
        name: "DefiLlama (Base USDC pools)",
        url: "https://defillama.com/yields?chain=Base&token=USDC",
      },
    ],
  };
}

/** Mantua's stablecoins → CoinGecko ids. */
const MANTUA_MARKET_TOKENS = [
  { id: "usd-coin", label: "USDC" },
  { id: "euro-coin", label: "EURC" },
] as const;

interface CoinGeckoMarket {
  id: string;
  current_price: number;
  price_change_percentage_24h: number | null;
  market_cap: number | null;
  total_volume: number | null;
}

async function marketSummary(): Promise<AnalyzeResponse> {
  // One cached CoinGecko /coins/markets call (price + 24h change + mcap +
  // volume) for the three Mantua tokens. The analyze topic cache (5-min TTL)
  // keeps this to ~1 call/5min, well inside CoinGecko's keyless limit.
  const ids = MANTUA_MARKET_TOKENS.map((t) => t.id).join(",");
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`,
  );
  if (!res.ok) throw new Error(`CoinGecko markets ${String(res.status)}`);
  const rows = (await res.json()) as CoinGeckoMarket[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const metrics: { label: string; value: string }[] = [];
  let mover: { label: string; change: number } | null = null;
  for (const t of MANTUA_MARKET_TOKENS) {
    const m = byId.get(t.id);
    if (!m) continue;
    const change = m.price_change_percentage_24h ?? 0;
    if (mover === null || Math.abs(change) > Math.abs(mover.change)) {
      mover = { label: t.label, change };
    }
    metrics.push({
      label: t.label,
      value: `${fmtUsd(m.current_price)} (${fmtPct(change)}, mcap ${fmtUsd(m.market_cap ?? 0)})`,
    });
  }
  if (metrics.length === 0) throw new Error("CoinGecko: no market data");

  return {
    topic: "market-summary",
    title: "Stablecoin market summary — USDC & EURC",
    summary: `Live market data for Mantua's stablecoins, USDC and EURC.${
      mover ? ` Larger 24h move: ${mover.label} at ${fmtPct(mover.change)}.` : ""
    }`,
    metrics,
    sources: [{ name: "CoinGecko", url: "https://www.coingecko.com/en/categories/stablecoins" }],
  };
}

/** Mantua's hooked pools on Base (hook + pair + static fee tier). */
const BASE_POOLS: { hook: HookName; a: TokenSymbol; b: TokenSymbol; fee: FeeTier; label: string }[] =
  [
    { hook: "stable-protection", a: "USDC", b: "EURC", fee: 100, label: "Stable Protection" },
    { hook: "dynamic-fee", a: "USDC", b: "cbBTC", fee: 3000, label: "Dynamic Fee" },
    { hook: "dynamic-fee", a: "EURC", b: "cbBTC", fee: 3000, label: "Dynamic Fee" },
  ];

/** sqrtPriceX96 → human price (token1 per token0), decimal-adjusted. */
function priceFromSqrt(sqrtPriceX96: bigint, dec0: number, dec1: number): number {
  const r = Number(sqrtPriceX96) / 2 ** 96;
  return r * r * 10 ** (dec0 - dec1);
}

async function basePools(): Promise<AnalyzeResponse> {
  const metrics: { label: string; value: string }[] = [];
  let liveCount = 0;
  for (const p of BASE_POOLS) {
    const hookAddr = getHookAddress(p.hook);
    if (!hookAddr) continue;
    const { key, flipped } = buildPoolKey(p.a, p.b, p.fee, hookAddr, p.hook);
    const sym0 = flipped ? p.b : p.a;
    const sym1 = flipped ? p.a : p.b;
    let slot0: Awaited<ReturnType<typeof readSlot0>> = null;
    try {
      slot0 = await readSlot0(key);
    } catch (err) {
      logger.warn({ err, pool: `${sym0}/${sym1}` }, "base-pools slot0 read failed");
    }
    if (!slot0) {
      metrics.push({ label: `${sym0}/${sym1} · ${p.label}`, value: "not initialized" });
      continue;
    }
    liveCount += 1;
    const price = priceFromSqrt(
      slot0.sqrtPriceX96,
      getToken(sym0).decimals,
      getToken(sym1).decimals,
    );
    metrics.push({
      label: `${sym0}/${sym1} · ${p.label}`,
      value: `1 ${sym0} = ${price.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${sym1} (tick ${String(slot0.tick)})`,
    });
  }
  return {
    topic: "base-pools",
    title: "Live Mantua pools on Base",
    summary: `${String(liveCount)} of ${String(BASE_POOLS.length)} Mantua hooked pools are initialized on Base — prices read live from on-chain v4 state.`,
    metrics,
    sources: [{ name: "BaseScan", url: "https://basescan.org" }],
  };
}

const STABLECOIN_LIST: { symbol: string; name: string; coingeckoId: string; peg: string }[] = [
  { symbol: "USDC", name: "USD Coin", coingeckoId: "usd-coin", peg: "USD" },
  { symbol: "USDT", name: "Tether", coingeckoId: "tether", peg: "USD" },
  { symbol: "DAI", name: "Dai", coingeckoId: "dai", peg: "USD" },
  { symbol: "EURC", name: "Euro Coin", coingeckoId: "euro-coin", peg: "EUR" },
  { symbol: "agEUR", name: "Angle EUR", coingeckoId: "ageur", peg: "EUR" },
];

async function topStablecoins(): Promise<AnalyzeResponse> {
  const keys = STABLECOIN_LIST.map((t) => `coingecko:${t.coingeckoId}`);
  const [prices, changes] = await Promise.all([getTokenPrices(keys), getTokenChangePercents(keys)]);
  const rows = STABLECOIN_LIST.map((t) => {
    const k = `coingecko:${t.coingeckoId}`;
    return {
      ...t,
      price: prices[k]?.price ?? 0,
      change: changes[k] ?? 0,
    };
  })
    .filter((r) => r.price > 0)
    .sort((a, b) => b.change - a.change);
  if (rows.length === 0) {
    return {
      topic: "top-stablecoins",
      title: "Top stablecoins",
      summary: "Couldn't pull live prices right now. Try again in a minute.",
      sources: [{ name: "DefiLlama" }],
    };
  }
  const winner = rows[0];
  return {
    topic: "top-stablecoins",
    title: "Top performing stablecoins (24h)",
    summary: `Across the major stablecoins, ${winner.name} (${winner.symbol}) leads the day at ${fmtPct(winner.change)}. Sorted by 24h change:`,
    metrics: rows.map((r) => ({
      label: `${r.symbol} (${r.peg} peg)`,
      value: `${fmtUsd(r.price)} · ${fmtPct(r.change)}`,
    })),
    sources: [{ name: "DefiLlama", url: "https://defillama.com/coins" }],
  };
}

async function tokenPrice(symbol: string): Promise<AnalyzeResponse> {
  const alias = resolveTokenAlias(symbol);
  if (!alias) {
    return {
      topic: "token-price",
      title: `Price lookup: ${symbol}`,
      summary: `I don't have ${symbol} in my alias map yet. Known names: bitcoin, ethereum, cbBTC, USDC, USDT, EURC, WETH, MKR, PENDLE, ONDO, CFG, SOL.`,
    };
  }
  const key = `coingecko:${alias.coingeckoId}`;
  const [prices, changes] = await Promise.all([
    getTokenPrices([key]),
    getTokenChangePercents([key]),
  ]);
  const price = prices[key]?.price;
  if (price === undefined) {
    return {
      topic: "token-price",
      title: `${alias.label} (${alias.symbol})`,
      summary: `DefiLlama didn't return a price for ${alias.label} just now. Try again in a moment.`,
    };
  }
  const change = changes[key] ?? 0;
  return {
    topic: "token-price",
    title: `${alias.label} (${alias.symbol}) spot price`,
    summary: `${alias.label} (${alias.symbol}) is trading at ${fmtUsd(price)}${
      Number.isFinite(change) ? `, ${fmtPct(change)} in the last 24h` : ""
    }.`,
    metrics: [
      { label: "Price", value: fmtUsd(price) },
      { label: "24h change", value: fmtPct(change) },
    ],
    sources: [
      { name: "DefiLlama", url: `https://defillama.com/coins/coingecko:${alias.coingeckoId}` },
    ],
  };
}

function mantuaHooks(): AnalyzeResponse {
  return {
    topic: "mantua-hooks",
    title: "Mantua hooks",
    summary:
      "Mantua ships two hooks on Base: Stable Protection and Dynamic Fee. Each plugs into the pool lifecycle to add behavior vanilla pools can't.",
    bullets: [
      "Stable Protection — FX-aware peg-zone pool. Reads virtual reserves at every swap, measures deviation against a live EUR/USD reference (Pyth), classifies HEALTHY through CRITICAL, and blocks or surcharges trades during real depegs. Pair: USDC/EURC.",
      "Dynamic Fee — adjusts the per-swap fee on every trade based on a TWAP-derived volatility signal. Rewards LPs more during turbulence; cheaper for stable flow. Pairs: USDC/cbBTC and EURC/cbBTC.",
    ],
    sources: [
      { name: "Uniswap v4 Hooks", url: "https://docs.uniswap.org/contracts/v4/concepts/hooks" },
    ],
  };
}

/**
 * Coinbase spot prices for the three Mantua assets via Coinbase's public
 * (no-auth) market-data endpoints. cbBTC is BTC-pegged, so it tracks
 * Coinbase's BTC-USD (which also carries 24h change). USDC/EURC come from
 * the public spot endpoint. Read-only — no trading/keys involved.
 */
async function coinbasePrices(): Promise<AnalyzeResponse> {
  const [btc, eurc, usdc] = await Promise.all([
    getCoinbaseMarket("BTC-USD"),
    getCoinbaseSpot("EURC-USD"),
    getCoinbaseSpot("USDC-USD"),
  ]);
  const metrics: AnalyzeMetric[] = [];
  if (usdc !== null) metrics.push({ label: "USDC", value: fmtUsd(usdc) });
  if (eurc !== null) metrics.push({ label: "EURC", value: fmtUsd(eurc) });
  if (btc) {
    metrics.push({
      label: "cbBTC (tracks BTC)",
      value: fmtUsd(btc.price),
      ...(btc.change24hPct !== null ? { hint: `${fmtPct(btc.change24hPct)} 24h` } : {}),
    });
  }
  if (metrics.length === 0) throw new Error("Coinbase: no market data available");
  const btcChange = btc?.change24hPct;
  return {
    topic: "coinbase-prices",
    title: "Coinbase spot prices",
    summary: `Coinbase spot (read-only public market data): USDC ${usdc !== null ? fmtUsd(usdc) : "—"}, EURC ${eurc !== null ? fmtUsd(eurc) : "—"}. cbBTC is BTC-pegged and tracks Coinbase BTC at ${btc ? fmtUsd(btc.price) : "—"}${btcChange != null ? ` (${fmtPct(btcChange)} 24h)` : ""}.`,
    metrics,
    sources: [
      {
        name: "Coinbase Advanced Trade (public market data)",
        url: "https://www.coinbase.com/advanced-trade",
      },
    ],
  };
}

const TOPIC_RUNNERS: Record<
  Exclude<Topic, "token-price">,
  () => Promise<AnalyzeResponse> | AnalyzeResponse
> = {
  "eth-price": ethPrice,
  "cbbtc-price": cbbtcPrice,
  "eurc-peg": eurcPeg,
  "usdc-eurc-pool": usdcEurcPool,
  "top-stablecoins": topStablecoins,
  "cbbtc-24h-volume": cbbtc24hVolume,
  "usdc-24h-volume": usdc24hVolume,
  "market-summary": marketSummary,
  "base-pools": basePools,
  "coinbase-prices": coinbasePrices,
  "mantua-hooks": mantuaHooks,
};

/**
 * Per-topic response cache. CoinGecko's free tier (10–30 req/min)
 * gets blown out fast otherwise — every suggestion click previously
 * fired a fresh fetch even when the price barely changed. Two TTLs:
 * `freshTtl` is the "no need to refetch" window; `staleTtl` keeps a
 * stale response around so 429s during a brief upstream hiccup still
 * surface a real answer (with a tiny "cached" hint) instead of an
 * error card.
 */
interface CacheEntry {
  response: AnalyzeResponse;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();

const PRICE_TTL = { freshMs: 5 * 60_000, staleMs: 30 * 60_000 };
const POOL_TTL = { freshMs: 5 * 60_000, staleMs: 60 * 60_000 };
const STATIC_TTL = { freshMs: Number.MAX_SAFE_INTEGER, staleMs: Number.MAX_SAFE_INTEGER };

const TOPIC_TTL: Record<Topic, { freshMs: number; staleMs: number }> = {
  "mantua-hooks": STATIC_TTL,
  "eth-price": PRICE_TTL,
  "cbbtc-price": PRICE_TTL,
  "eurc-peg": PRICE_TTL,
  "top-stablecoins": PRICE_TTL,
  "token-price": PRICE_TTL,
  "usdc-eurc-pool": POOL_TTL,
  "cbbtc-24h-volume": POOL_TTL,
  "usdc-24h-volume": POOL_TTL,
  "market-summary": PRICE_TTL,
  // Live on-chain reads — short fresh window so prices reflect recent swaps.
  "base-pools": { freshMs: 30_000, staleMs: 5 * 60_000 },
  "coinbase-prices": PRICE_TTL,
};

/**
 * Cache key for `token-price` includes the symbol so different
 * lookups don't clobber each other; everything else just keys on
 * the topic name.
 */
function cacheKey(topic: Topic, symbol?: string): string {
  return topic === "token-price" ? `token-price:${(symbol ?? "").toLowerCase()}` : topic;
}

export async function runAnalyze(topic: Topic, symbol?: string): Promise<AnalyzeResponse> {
  const ttl = TOPIC_TTL[topic];
  const key = cacheKey(topic, symbol);
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < ttl.freshMs) {
    return cached.response;
  }
  try {
    const response =
      topic === "token-price" ? await tokenPrice(symbol ?? "") : await TOPIC_RUNNERS[topic]();
    cache.set(key, { response, fetchedAt: now });
    return response;
  } catch (err) {
    logger.warn({ err, topic, symbol }, "analyze topic fetch failed");
    // Stale-while-error: if we have a cached answer that's still
    // within the stale window, serve it rather than 502'ing the user.
    if (cached && now - cached.fetchedAt < ttl.staleMs) {
      return {
        ...cached.response,
        summary: `${cached.response.summary} (cached)`,
      };
    }
    throw err;
  }
}
