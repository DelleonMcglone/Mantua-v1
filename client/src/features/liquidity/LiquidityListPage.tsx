import { useMemo, useState, useEffect } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { IS_MAINNET, type TokenSymbol } from "@/lib/tokens.ts";
import { networkKeyForChain } from "@/lib/chains.ts";
import { useTokenPrices } from "./use-token-prices.ts";
import { TokenPairIcon } from "./TokenPairIcon.tsx";
import { usePools } from "./use-pools.ts";
import { FEE_TIER_LABELS } from "./fee-tiers.ts";
import { compact as formatUsd, pct as formatPct } from "@/lib/format.ts";
import { HOOK_TINT } from "@/features/portfolio/hook-tint.ts";
import { normalizePairSymbol } from "./format.ts";
import { getLocalPools, type LocalPool } from "./local-pools.ts";
import { getLocalPositions, type LocalPosition } from "./local-positions.ts";
import type { PoolSummary } from "./types.ts";
import { HOOK_LABELS } from "./hook-recommendations.ts";
import { usePortfolio } from "@/features/portfolio/use-portfolio.ts";
import { useOnchainPositions } from "@/features/portfolio/use-onchain-positions.ts";
import { useMarketPools } from "./use-market-pools.ts";
import {
  marketStatusLabel,
  marketStatusTone,
  showMarketStatusColumn,
  type MarketLiquidityTarget,
  type MarketPoolInfo,
} from "./market-pools.ts";

interface Props {
  onSelectPool: (poolId: string) => void;
  onCreate: () => void;
  /** B7-004 — market-pool rows open the liquidity surface in market
   *  mode. Omitted → market rows render but aren't clickable. */
  onSelectMarketPool?: (market: MarketLiquidityTarget) => void;
  onClose?: () => void;
}

type Category = "All" | "Stables" | "Majors" | "RWAs" | "Markets";

const BASE_CATEGORIES: Category[] = ["All", "Stables", "Majors", "RWAs"];
const STABLES = new Set(["USDC", "USDT", "DAI", "USDP", "FRAX", "TUSD"]);
const MAJORS = new Set(["ETH", "WETH", "cbBTC", "WBTC", "BTC"]);
const RWAS = new Set(["EURC", "EURS", "AGEUR"]);

/** B7-007 sort keys — all descending (biggest first). */
type SortKey = "tvl" | "volume" | "apr";
const SORT_LABELS: Record<SortKey, string> = { tvl: "TVL", volume: "Volume", apr: "APR" };
const SORT_KEYS: SortKey[] = ["tvl", "volume", "apr"];

type PoolNetwork = "base";

interface DerivedPool extends PoolSummary {
  pair: { a: string; b: string };
  category: Exclude<Category, "All">;
  hookLabel: string;
  hasHook: boolean;
  network: PoolNetwork;
  /** Market-pool rows only (B7-006): lifecycle state + open target. */
  marketStatus?: string;
  market?: MarketLiquidityTarget;
  sport?: string;
  league?: string;
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
export function LiquidityListPage({ onSelectPool, onCreate, onSelectMarketPool, onClose }: Props) {
  const { data, error, loading } = usePools();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("All");
  // B7-007 — filter/sort state. Sport/league/status filters only render
  // (and only apply) when market pools exist; sort is always available.
  const [sortKey, setSortKey] = useState<SortKey>("tvl");
  const [sportFilter, setSportFilter] = useState<string>("All");
  const [leagueFilter, setLeagueFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");

  // B7-006 — the pool↔market join. Empty while no markets exist, in
  // which case the market-status column (and the market filters) are
  // absent — not blank.
  const marketPools = useMarketPools();
  const hasMarketCol = showMarketStatusColumn(marketPools.data?.pools);
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

  // Market-pool rows (B7-006): one per market with a seeded YES/USDC
  // pool. TVL/volume aren't indexed for these yet — zeros, like local
  // pools — but pair, hook badge, fee tier, and market status all render.
  const marketRows = useMemo<DerivedPool[]>(() => {
    const pools: MarketPoolInfo[] = marketPools.data?.pools ?? [];
    return pools.map((p) => ({
      id: `market:${p.poolId}`,
      symbol: `${p.label} YES-USDC`,
      project: "mantua",
      feeTier: "Dynamic",
      tvlUsd: 0,
      apy: 0,
      volumeUsd1d: 0,
      volumeUsd7d: 0,
      underlyingTokens: [],
      stablecoin: false,
      pair: { a: `${p.label} YES`, b: "USDC" },
      category: "Markets" as const,
      hookLabel: "Dynamic Market",
      hasHook: true,
      network: "base" as const,
      marketStatus: p.state,
      market: {
        providerEventId: p.providerEventId,
        outcomeIndex: p.outcomeIndex === 1 ? 1 : 0,
        label: p.label,
        event: p.event,
      },
      sport: p.sport,
      league: p.league,
    }));
  }, [marketPools.data]);

  const enriched = useMemo(() => {
    const remote = [...marketRows, ...(data ?? []).map(classifyPool)];
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
  }, [data, localPools, ownedPoolKeys, localTvlByKey, marketRows]);

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
      Markets: 0,
    };
    for (const p of enriched) c[p.category] += 1;
    return c;
  }, [enriched]);

  // The "Markets" category tab appears only alongside the market column.
  const categories = useMemo<Category[]>(
    () => (hasMarketCol ? [...BASE_CATEGORIES, "Markets"] : BASE_CATEGORIES),
    [hasMarketCol],
  );

  // B7-007 — filter option values, derived from the live market rows.
  const marketFilterOptions = useMemo(() => {
    const sports = new Set<string>();
    const leagues = new Set<string>();
    const statuses = new Set<string>();
    for (const p of marketRows) {
      if (p.sport) sports.add(p.sport);
      if (p.league) leagues.add(p.league);
      if (p.marketStatus) statuses.add(p.marketStatus);
    }
    return {
      sports: ["All", ...[...sports].sort()],
      leagues: ["All", ...[...leagues].sort()],
      statuses: ["All", ...[...statuses].sort()],
    };
  }, [marketRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const marketFiltersActive =
      sportFilter !== "All" || leagueFilter !== "All" || statusFilter !== "All";
    const rows = enriched.filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      // Sport/league/status are market attributes: an active market
      // filter narrows to market rows matching it (base pairs have no
      // sport, so they drop out while one is applied).
      if (marketFiltersActive) {
        if (!p.market) return false;
        if (sportFilter !== "All" && p.sport !== sportFilter) return false;
        if (leagueFilter !== "All" && p.league !== leagueFilter) return false;
        if (statusFilter !== "All" && p.marketStatus !== statusFilter) return false;
      }
      if (!q) return true;
      const hay = `${p.pair.a} ${p.pair.b} ${p.pair.a}/${p.pair.b} ${p.hookLabel}`.toLowerCase();
      return hay.includes(q);
    });
    // B7-007 — sort descending on the selected metric, stable otherwise.
    const metric = (p: DerivedPool): number =>
      sortKey === "tvl" ? p.tvlUsd || 0 : sortKey === "volume" ? p.volumeUsd1d || 0 : p.apy || 0;
    return [...rows].sort((a, b) => metric(b) - metric(a));
  }, [enriched, query, category, sortKey, sportFilter, leagueFilter, statusFilter]);

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

        {/* B7-007 — the controls row wraps (responsive vertical collapse):
            at narrow widths the search keeps its own line and the
            filter/sort dropdowns stack beneath it. */}
        <div className="flex flex-wrap gap-2 mt-4 items-center">
          <div className="flex-1 min-w-[180px] basis-48 flex items-center gap-2 px-3.5 py-2 bg-bg-elev border border-border-soft rounded-md">
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-bg-elev border border-border-soft text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer"
              >
                {category}
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[170px]">
              {categories.map((c) => (
                <DropdownMenuItem
                  key={c}
                  onSelect={() => {
                    setCategory(c);
                  }}
                  className={`justify-between ${category === c ? "bg-chip" : ""}`}
                >
                  <span>{c}</span>
                  <span className="text-[11px] text-text-mute">{counts[c]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* B7-007 — market filters, joined only when markets exist
              (same shared dropdown primitive as the category filter). */}
          {hasMarketCol && (
            <>
              <FilterDropdown
                label="Sport"
                value={sportFilter}
                options={marketFilterOptions.sports}
                onChange={setSportFilter}
                format={(v) => (v === "All" ? v : v.toUpperCase())}
              />
              <FilterDropdown
                label="League"
                value={leagueFilter}
                options={marketFilterOptions.leagues}
                onChange={setLeagueFilter}
                format={(v) => (v === "All" ? v : v.toUpperCase())}
              />
              <FilterDropdown
                label="Status"
                value={statusFilter}
                options={marketFilterOptions.statuses}
                onChange={setStatusFilter}
                format={(v) => (v === "All" ? v : marketStatusLabel(v))}
              />
            </>
          )}

          <FilterDropdown
            label="Sort"
            value={sortKey}
            options={SORT_KEYS}
            onChange={setSortKey}
            format={(v) => `Sort: ${SORT_LABELS[v]}`}
          />

          <Button variant="primary" size="md" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" /> Create Pool
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-5 pb-2">
        {loading && (
          <p role="status" className="px-1 py-8 text-xs text-text-dim text-center">
            Loading pools…
          </p>
        )}
        {error && (
          <p role="alert" className="px-1 py-8 text-xs text-red text-center">
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
            <div
              className={`grid gap-3 py-2 text-[10px] uppercase tracking-wider text-text-mute border-b border-border-soft ${gridColumns(hasMarketCol)}`}
            >
              <span>Pool</span>
              <span className="text-right">TVL{sortKey === "tvl" ? " ↓" : ""}</span>
              <span className="text-right">
                Volume (24H){sortKey === "volume" ? " ↓" : ""}
              </span>
              <span className="text-right hidden md:block">Fee Tier</span>
              <span className="text-right hidden md:block">Fees (24H)</span>
              <span className="text-right hidden md:block">
                APR{sortKey === "apr" ? " ↓" : ""}
              </span>
              {/* B7-006 — market-status column joins ONLY when markets
                  exist; with none it is absent, not empty. */}
              {hasMarketCol && <span className="text-right">Market</span>}
            </div>
            <div className="flex-1 overflow-auto">
              <ul className="pt-1.5">
                {filtered.slice(0, 50).map((p) => (
                  <PoolRow
                    key={p.id}
                    pool={p}
                    hasMarketCol={hasMarketCol}
                    onSelect={onSelectPool}
                    {...(onSelectMarketPool ? { onSelectMarket: onSelectMarketPool } : {})}
                  />
                ))}
              </ul>
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

/**
 * Shared row/header grid classes — one extra column when the market join
 * is live, and a responsive vertical collapse (B7-007): below `md` the
 * fee-tier / fees / APR cells fold away (they carry `hidden md:block`),
 * leaving Pool · TVL · Volume (· Market).
 */
function gridColumns(hasMarketCol: boolean): string {
  return hasMarketCol
    ? "grid-cols-[1.6fr_1fr_1fr_0.8fr] md:grid-cols-[1.6fr_1fr_1fr_0.7fr_0.9fr_0.6fr_0.8fr]"
    : "grid-cols-[1.6fr_1fr_1fr] md:grid-cols-[1.6fr_1fr_1fr_0.7fr_0.9fr_0.6fr]";
}

function PoolRow({
  pool,
  hasMarketCol,
  onSelect,
  onSelectMarket,
}: {
  pool: DerivedPool;
  hasMarketCol: boolean;
  onSelect: (id: string) => void;
  onSelectMarket?: (market: MarketLiquidityTarget) => void;
}) {
  const tier = pool.feeTier ?? "—";
  const tierBps = parseFeeTierToBps(pool.feeTier);
  const fees24 = ((pool.volumeUsd1d || 0) * tierBps) / 10_000;
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          // Market rows open the liquidity surface in market mode
          // (B7-004); base rows keep the pool-detail navigation.
          if (pool.market) {
            onSelectMarket?.(pool.market);
            return;
          }
          onSelect(pool.id);
        }}
        className={`grid gap-3 items-center w-full py-3 hover:bg-row-hover transition-colors text-left border-b border-border-soft cursor-pointer ${gridColumns(hasMarketCol)}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {!pool.market && <TokenPairIcon a={pool.pair.a} b={pool.pair.b} size={22} />}
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate">
              {pool.pair.a} / {pool.pair.b}
            </div>
            <div className="text-[11px] text-text-mute mt-0.5 flex items-center gap-1.5">
              <HookBadge hasHook={pool.hasHook} label={pool.hookLabel} />
            </div>
          </div>
        </div>
        <span className="text-[13px] font-mono text-right">{formatUsd(pool.tvlUsd)}</span>
        <span className="text-[13px] font-mono text-right">{formatUsd(pool.volumeUsd1d)}</span>
        <span className="text-[12px] font-mono text-right text-text-dim hidden md:block">
          {tier}
        </span>
        <span className="text-[13px] font-mono text-right hidden md:block">
          {formatUsd(fees24)}
        </span>
        <span className="text-[13px] font-mono text-right text-green hidden md:block">
          {formatPct(pool.apy)}
        </span>
        {hasMarketCol && (
          <span className="text-right">
            {pool.marketStatus ? <MarketStatusBadge state={pool.marketStatus} /> : null}
          </span>
        )}
      </button>
    </li>
  );
}

/** B7-006 — market lifecycle badge (Open / Frozen / Resolved / …). */
function MarketStatusBadge({ state }: { state: string }) {
  const tone = marketStatusTone(state);
  const tint =
    tone === "live"
      ? "bg-green/15 text-green"
      : tone === "paused"
        ? "bg-amber/15 text-amber"
        : "bg-chip text-text-mute";
  return (
    <span className={`px-1.5 py-px rounded-[6px] text-[10px] font-semibold tracking-[0.01em] ${tint}`}>
      {marketStatusLabel(state)}
    </span>
  );
}

/**
 * B7-007 — one dropdown to rule the filters, built on the SHARED
 * `components/ui/dropdown-menu` primitive (the design wave's named
 * failure mode is a second bespoke dropdown — this is not one).
 */
function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  format,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  const show = format ?? ((v: T) => v);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Filter by ${label.toLowerCase()}`}
          className="px-3 py-2 rounded-md bg-bg-elev border border-border-soft text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer"
        >
          {show(value)}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {options.map((o) => (
          <DropdownMenuItem
            key={o}
            onSelect={() => {
              onChange(o);
            }}
            className={value === o ? "bg-chip" : ""}
          >
            {show(o)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HookBadge({ hasHook, label }: { hasHook: boolean; label: string }) {
  // Shared token-class palette (deduped with the portfolio's badge tints)
  // so a hook reads the same color everywhere in both themes.
  const tint =
    hasHook && (label === "Stable Protection" || label === "Dynamic Fee")
      ? HOOK_TINT[label]
      : undefined;
  if (tint) {
    return (
      <span
        className={`px-1.5 py-px rounded-[6px] text-[10px] font-semibold tracking-[0.01em] ${tint}`}
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
