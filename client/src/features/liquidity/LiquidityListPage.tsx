import { useMemo, useRef, useState, useEffect } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import { IS_MAINNET, type TokenSymbol } from "@/lib/tokens.ts";
import { NetworkLogo } from "@/components/shell/network-icons.tsx";
import { networkKeyForChain } from "@/lib/chains.ts";
import { useTokenPrices } from "./use-token-prices.ts";
import { TokenPairIcon } from "./TokenPairIcon.tsx";
import { usePools } from "./use-pools.ts";
import { FEE_TIER_LABELS } from "./fee-tiers.ts";
import { formatPct, formatUsd, normalizePairSymbol } from "./format.ts";
import { getLocalPools, type LocalPool } from "./local-pools.ts";
import { getLocalPositions, type LocalPosition } from "./local-positions.ts";
import type { PoolSummary } from "./types.ts";
import { HOOK_LABELS } from "./hook-recommendations.ts";
import { usePortfolio } from "@/features/portfolio/use-portfolio.ts";
import { useOnchainPositions } from "@/features/portfolio/use-onchain-positions.ts";

interface Props {
  onSelectPool: (poolId: string) => void;
  onCreate: () => void;
  onClose?: () => void;
}

type Category = "All" | "Stables" | "Majors" | "RWAs";

const CATEGORIES: Category[] = ["All", "Stables", "Majors", "RWAs"];
const STABLES = new Set(["USDC", "USDT", "DAI", "USDP", "FRAX", "TUSD"]);
const MAJORS = new Set(["ETH", "WETH", "cbBTC", "WBTC", "BTC"]);
const RWAS = new Set(["EURC", "EURS", "AGEUR"]);

type PoolNetwork = "base";

interface DerivedPool extends PoolSummary {
  pair: { a: string; b: string };
  category: Exclude<Category, "All">;
  hookLabel: string;
  hasHook: boolean;
  network: PoolNetwork;
}

function classifyPool(p: PoolSummary): DerivedPool {
  const sym = normalizePairSymbol(p.symbol);
  const [aRaw, bRaw] = sym.split("-") as (string | undefined)[];
  const a = aRaw ?? "?";
  const b = bRaw ?? "?";
  const aStable = STABLES.has(a);
  const bStable = STABLES.has(b);
  const aMajor = MAJORS.has(a);
  const bMajor = MAJORS.has(b);
  const aRwa = RWAS.has(a);
  const bRwa = RWAS.has(b);
  let category: DerivedPool["category"];
  if (aRwa || bRwa) category = "RWAs";
  else if (aStable && bStable) category = "Stables";
  else if (aMajor || bMajor) category = "Majors";
  else category = "Majors";
  // Hook metadata isn't part of the pool data yet — keep "No Hook" for
  // now; will light up once Mantua-managed pools land in the response.
  const hookLabel = "No Hook";
  // Remote (DefiLlama) pools are Base ecosystem data; locally-created
  // pools carry their own chainId and are tagged where they're built.
  return { ...p, pair: { a, b }, category, hookLabel, hasHook: false, network: "base" };
}

/**
 * Pool list — matches `PoolListPanel` in panels.jsx. Chrome: shared
 * `<PanelHeader />` + "Create Pool" subheader (subtitle "Explore and
 * manage your liquidity positions") with close X. Body: 3 stat tiles
 * (TVL/Volume/Fees), search + category filter + primary Create Pool
 * CTA, then pool table with token-pair icons + hook badges.
 */
export function LiquidityListPage({ onSelectPool, onCreate, onClose }: Props) {
  const { data, error, loading } = usePools();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("All");
  const [openCat, setOpenCat] = useState(false);
  const catRef = useRef<HTMLDivElement | null>(null);
  const [localPools, setLocalPools] = useState<LocalPool[]>(() =>
    IS_MAINNET ? [] : getLocalPools(),
  );
  const [localPositions, setLocalPositions] = useState<LocalPosition[]>(() =>
    IS_MAINNET ? [] : getLocalPositions(),
  );

  // Only show pools the user actually holds a position in. Source the
  // positions on-chain (authoritative, matches the Positions tab); fall back
  // to the localStorage breadcrumb while that loads. Keyed by pair+hook —
  // each (pair, hook) has one canonical tier in the two-hook model.
  const { walletAddress } = usePortfolio();
  const onchainPositions = useOnchainPositions(walletAddress);
  const ownedPoolKeys = useMemo<Set<string>>(() => {
    const positions = onchainPositions.data ?? localPositions;
    const keyOf = (a: string, b: string, hook: string | null) => {
      const [x, y] = [a, b].sort();
      return `${x}|${y}|${hook ?? "none"}`;
    };
    return new Set(positions.map((p) => keyOf(p.tokenA, p.tokenB, p.hook)));
  }, [onchainPositions.data, localPositions]);

  // Pull live USD prices for every token symbol present in the local
  // pool list — used to convert per-position deposit amounts into a
  // pool-level TVL approximation. Stable→stable pairs and ETH-quoted
  // pairs all resolve via CoinGecko's existing 60s cache.
  const symbolsForPricing = useMemo<TokenSymbol[]>(() => {
    if (IS_MAINNET) return [];
    const set = new Set<TokenSymbol>();
    for (const p of localPools) {
      set.add(p.tokenA);
      set.add(p.tokenB);
    }
    return [...set];
  }, [localPools]);
  const tokenPrices = useTokenPrices(symbolsForPricing);

  // Sum each position's `amountA * priceA + amountB * priceB`, bucketed
  // by the pool's key. Source the amounts on-chain (authoritative — every
  // owned position carries live amounts, including pools with no
  // localStorage breadcrumb, e.g. a No-Hook pool whose mint-capture never
  // landed), falling back to the breadcrumb while that read is in flight.
  // POC-grade: a token with no USD price contributes 0 for
  // its side.
  const localTvlByKey = useMemo<Record<string, number>>(() => {
    if (IS_MAINNET) return {};
    const out: Record<string, number> = {};
    const accum = (key: string, addend: number) => {
      out[key] = (out[key] ?? 0) + addend;
    };
    const source = onchainPositions.data ?? localPositions;
    for (const pos of source) {
      const [a, b] = [pos.tokenA, pos.tokenB].sort();
      const key = `${String(pos.chainId)}|${a}|${b}|${String(pos.fee)}|${pos.hook ?? "none"}`;
      const amA = parseFloat(pos.amountA);
      const amB = parseFloat(pos.amountB);
      const pA = tokenPrices.prices[pos.tokenA] ?? 0;
      const pB = tokenPrices.prices[pos.tokenB] ?? 0;
      accum(key, (Number.isFinite(amA) ? amA : 0) * pA);
      accum(key, (Number.isFinite(amB) ? amB : 0) * pB);
    }
    return out;
  }, [onchainPositions.data, localPositions, tokenPrices.prices]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!catRef.current) return;
      if (!catRef.current.contains(e.target as Node)) setOpenCat(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, []);

  // Re-read localStorage when the panel mounts so freshly-created
  // pools (and the positions that drive their TVL) show up without
  // a manual refresh.
  useEffect(() => {
    if (IS_MAINNET) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLocalPools(getLocalPools());
    setLocalPositions(getLocalPositions());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const enriched = useMemo(() => {
    const remote = (data ?? []).map(classifyPool);
    if (IS_MAINNET) return remote;
    // In local-pool mode, show only pools the user holds a position in (by
    // pair+hook). Synthesize a minimal `PoolSummary` shape so the existing
    // row renderer works without a special-case branch.
    const local: DerivedPool[] = localPools
      .filter((p) => {
        const [a, b] = [p.tokenA, p.tokenB].sort();
        return ownedPoolKeys.has(`${a}|${b}|${p.hook ?? "none"}`);
      })
      .map((p) => {
        const aStable = STABLES.has(p.tokenA);
        const bStable = STABLES.has(p.tokenB);
        const aMajor = MAJORS.has(p.tokenA);
        const bMajor = MAJORS.has(p.tokenB);
        const aRwa = RWAS.has(p.tokenA);
        const bRwa = RWAS.has(p.tokenB);
        let category: DerivedPool["category"];
        if (aRwa || bRwa) category = "RWAs";
        else if (aStable && bStable) category = "Stables";
        else if (aMajor || bMajor) category = "Majors";
        else category = "Majors";
        const hookLabel = p.hook ? HOOK_LABELS[p.hook] : "Volatile";
        const tvlUsd = localTvlByKey[p.key] ?? 0;
        return {
          id: `local:${p.key}`,
          symbol: `${p.tokenA}-${p.tokenB}`,
          project: "mantua",
          feeTier: FEE_TIER_LABELS[p.fee],
          tvlUsd,
          apy: 0,
          volumeUsd1d: 0,
          volumeUsd7d: 0,
          underlyingTokens: [],
          stablecoin: aStable && bStable,
          pair: { a: p.tokenA, b: p.tokenB },
          category,
          hookLabel,
          hasHook: p.hook !== null,
          network: networkKeyForChain(p.chainId),
        };
      });
    return [...local, ...remote];
  }, [data, localPools, ownedPoolKeys, localTvlByKey]);

  const totals = useMemo(() => {
    const tvl = enriched.reduce((s, p) => s + (p.tvlUsd || 0), 0);
    const vol = enriched.reduce((s, p) => s + (p.volumeUsd1d || 0), 0);
    // DefiLlama's pool list has no per-pool fee figure; estimate via
    // (volume * fee tier). When the response gains a fees field, use it.
    const fees = enriched.reduce((s, p) => {
      const tierBps = parseFeeTierToBps(p.feeTier);
      return s + ((p.volumeUsd1d || 0) * tierBps) / 10_000;
    }, 0);
    return { tvl, vol, fees };
  }, [enriched]);

  const counts = useMemo(() => {
    const c: Record<Category, number> = {
      All: enriched.length,
      Stables: 0,
      Majors: 0,
      RWAs: 0,
    };
    for (const p of enriched) c[p.category] += 1;
    return c;
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (!q) return true;
      const hay = `${p.pair.a} ${p.pair.b} ${p.pair.a}/${p.pair.b} ${p.hookLabel}`.toLowerCase();
      return hay.includes(q);
    });
  }, [enriched, query, category]);

  return (
    <>
      <PanelHeader />
      <PanelSubHeader
        title="Create Pool"
        subtitle="Explore and manage your liquidity positions."
        {...(onClose ? { onClose } : {})}
      />

      <div className="px-5 pt-2 pb-3">
        <div className="grid grid-cols-3 gap-2.5">
          <StatTile label="TVL" value={formatUsd(totals.tvl)} />
          <StatTile label="VOLUME" value={formatUsd(totals.vol)} />
          <StatTile label="FEES" value={formatUsd(totals.fees)} />
        </div>

        <div className="flex gap-2 mt-4 items-center">
          <div className="flex-1 flex items-center gap-2 px-3.5 py-2 bg-bg-elev border border-border-soft rounded-md">
            <Search className="h-3.5 w-3.5 text-text-mute" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              placeholder="Search pools or hooks..."
              className="flex-1 bg-transparent border-none outline-none text-[13px] text-text"
            />
          </div>

          <div className="relative" ref={catRef}>
            <button
              type="button"
              onClick={() => {
                setOpenCat((v) => !v);
              }}
              className="px-3 py-2 rounded-md bg-bg-elev border border-border-soft text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer"
            >
              {category}
              <ChevronDown className="h-3 w-3" />
            </button>
            {openCat && (
              <div className="absolute right-0 top-full mt-1 z-30 min-w-[170px] bg-panel-solid border border-border rounded-md p-1 shadow-xl">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCategory(c);
                      setOpenCat(false);
                    }}
                    className={`flex items-center justify-between w-full px-2.5 py-2 rounded-xs text-left text-[13px] cursor-pointer ${
                      category === c
                        ? "bg-chip text-text"
                        : "bg-transparent text-text hover:bg-row-hover"
                    }`}
                  >
                    <span>{c}</span>
                    <span className="text-[11px] text-text-mute">{counts[c]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button variant="primary" size="md" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" /> Create Pool
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-5 pb-2">
        {loading && <p className="px-1 py-8 text-xs text-text-dim text-center">Loading pools…</p>}
        {error && (
          <p className="px-1 py-8 text-xs text-red text-center">
            Failed to load pools: {error.message}
          </p>
        )}
        {!loading && !error && filtered.length === 0 && (
          <p className="px-1 py-8 text-xs text-text-dim text-center">
            {enriched.length === 0
              ? "No pools yet. Create one to get started."
              : "No pools match your search."}
          </p>
        )}

        {filtered.length > 0 && (
          <>
            <div className="grid grid-cols-[1.6fr_1fr_1fr_0.9fr_0.6fr] gap-3 py-2 text-[10px] uppercase tracking-wider text-text-mute border-b border-border-soft">
              <span>Pool</span>
              <span className="text-right">TVL ↓</span>
              <span className="text-right">Volume (24H)</span>
              <span className="text-right">Fees (24H)</span>
              <span className="text-right">APR</span>
            </div>
            <div className="flex-1 overflow-auto">
              {(["base"] as const).map((net) => {
                const group = filtered.slice(0, 50);
                if (group.length === 0) return null;
                return (
                  <div key={net}>
                    <div className="flex items-center gap-2 pt-3 pb-1.5">
                      <NetworkLogo network={net} size={14} />
                      <span className="text-[11px] text-text-mute uppercase tracking-wide font-medium">
                        Base
                      </span>
                    </div>
                    <ul>
                      {group.map((p) => (
                        <PoolRow key={p.id} pool={p} onSelect={onSelectPool} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-elev border border-border-soft rounded-md px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-mute">{label}</div>
      <div className="text-[22px] font-semibold mt-1 -tracking-[0.01em] font-mono">{value}</div>
    </div>
  );
}

function PoolRow({ pool, onSelect }: { pool: DerivedPool; onSelect: (id: string) => void }) {
  const tier = pool.feeTier ?? "—";
  const tierBps = parseFeeTierToBps(pool.feeTier);
  const fees24 = ((pool.volumeUsd1d || 0) * tierBps) / 10_000;
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onSelect(pool.id);
        }}
        className="grid grid-cols-[1.6fr_1fr_1fr_0.9fr_0.6fr] gap-3 items-center w-full py-3 hover:bg-row-hover transition-colors text-left border-b border-border-soft cursor-pointer"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <TokenPairIcon a={pool.pair.a} b={pool.pair.b} size={22} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium">
              {pool.pair.a} / {pool.pair.b}
            </div>
            <div className="text-[11px] text-text-mute mt-0.5 flex items-center gap-1.5">
              <span>{tier}</span>
              <HookBadge hasHook={pool.hasHook} label={pool.hookLabel} />
            </div>
          </div>
        </div>
        <span className="text-[13px] font-mono text-right">{formatUsd(pool.tvlUsd)}</span>
        <span className="text-[13px] font-mono text-right">{formatUsd(pool.volumeUsd1d)}</span>
        <span className="text-[13px] font-mono text-right">{formatUsd(fees24)}</span>
        <span className="text-[13px] font-mono text-right text-green">{formatPct(pool.apy)}</span>
      </button>
    </li>
  );
}

/** Per-hook badge palette — mirrors the portfolio's HOOK_TINT so a hook
 *  reads the same color everywhere (Stable Protection green, Dynamic Fee
 *  yellow). Keyed by the HOOK_LABELS display strings. */
const HOOK_BADGE_TINT: Record<string, { bg: string; fg: string; bd: string }> = {
  "Stable Protection": {
    bg: "rgba(61, 220, 151, 0.14)",
    fg: "#3ddc97",
    bd: "rgba(61, 220, 151, 0.35)",
  },
  "Dynamic Fee": { bg: "rgba(230, 199, 74, 0.14)", fg: "#e6c74a", bd: "rgba(230, 199, 74, 0.35)" },
};

function HookBadge({ hasHook, label }: { hasHook: boolean; label: string }) {
  const tint = hasHook ? HOOK_BADGE_TINT[label] : undefined;
  if (tint) {
    return (
      <span
        className="px-1.5 py-px rounded-[6px] text-[10px] font-semibold tracking-[0.01em] border"
        style={{ background: tint.bg, color: tint.fg, borderColor: tint.bd }}
      >
        {label}
      </span>
    );
  }
  return (
    <span className="px-1.5 py-px rounded-[6px] text-[10px] font-medium tracking-[0.01em] bg-chip text-text-mute border border-border-soft">
      {label}
    </span>
  );
}

function parseFeeTierToBps(feeTier: string | null): number {
  if (!feeTier) return 0;
  const m = /([\d.]+)\s*%/.exec(feeTier);
  if (!m) return 0;
  const pct = parseFloat(m[1]);
  if (!Number.isFinite(pct)) return 0;
  return Math.round(pct * 100);
}
