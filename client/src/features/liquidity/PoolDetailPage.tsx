import { useMemo, useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { useCurrentChainId } from "@/lib/chain-context.tsx";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import { EXPLORER_URL, IS_MAINNET, TOKENS } from "@/lib/tokens.ts";
import { usePortfolio } from "@/features/portfolio/use-portfolio.ts";
import { useOnchainPositions } from "@/features/portfolio/use-onchain-positions.ts";
import type { PoolKeyContext } from "./AddLiquidityForm.tsx";
import { tryDeriveAddCtx } from "./defillama-translator.ts";
import { usePool } from "./use-pools.ts";
import { usePoolState } from "./use-pool-state.ts";
import { usePositions } from "./use-positions.ts";
import { getUserLocalPositions, mergeWithFreshBreadcrumbs } from "./local-positions.ts";
import { getLocalPools } from "./local-pools.ts";
import { localPositionToPosition } from "./position-adapters.ts";
import type { HookName } from "./use-create-pool.ts";
import { RemoveLiquidityModal } from "./RemoveLiquidityModal.tsx";
import { TvlChart } from "./TvlChart.tsx";
import { PairRateChart } from "./PairRateChart.tsx";
import { usePairPriceChart } from "./use-pair-price-chart.ts";
import { MetricToggle, RangeToggle, type Metric } from "./Toggles.tsx";
import { formatPct, formatUsd, normalizePairSymbol } from "./format.ts";
import type { ChartRange } from "./types.ts";
import type { Position } from "./positions-types.ts";

const EXPLORER = EXPLORER_URL;

interface Props {
  poolId: string;
  onBack: () => void;
  onAddLiquidity: (ctx: PoolKeyContext) => void;
  onClose?: () => void;
}

export function PoolDetailPage({ poolId, onBack, onAddLiquidity, onClose }: Props) {
  const [range, setRange] = useState<ChartRange>("30D");
  const [metric, setMetric] = useState<Metric>("tvl");
  const [removing, setRemoving] = useState<Position | null>(null);
  const { data, error, loading } = usePool(poolId, range);
  const positions = usePositions();
  const { walletAddress } = usePortfolio();
  const onchainPositions = useOnchainPositions(walletAddress);

  const chainId = useCurrentChainId();
  const derived = data ? tryDeriveAddCtx(data.pool, chainId) : null;

  // Pair exchange-rate chart (quote = tokenB priced in base = tokenA) — real
  // reference prices from DefiLlama since the local pool has no index.
  const pairChart = usePairPriceChart(derived?.tokenA ?? null, derived?.tokenB ?? null, range);

  // Authoritative hook for `local:<key>` pools — read straight from the
  // stored pool record rather than inferred from the fee tier, so a
  // no-hook pool can never inherit the pair's default recommendation
  // (e.g. USDC/EURC No-Hook must not open as Stable Protection).
  const localHook = useMemo<HookName | null | undefined>(() => {
    const PREFIX = "local:";
    if (!poolId.startsWith(PREFIX)) return undefined;
    const key = poolId.slice(PREFIX.length);
    return getLocalPools().find((p) => p.key === key)?.hook;
  }, [poolId]);

  // The `local:<key>` poolId encodes the exact pool key, so we can look
  // up the stored creation tx for the "Pool created" link. Prefer the
  // dedicated creation (initialize) tx; fall back to the last-activity
  // tx for pools created before createdTx was tracked.
  const creationTx = useMemo<string | null>(() => {
    const PREFIX = "local:";
    if (!poolId.startsWith(PREFIX)) return null;
    const key = poolId.slice(PREFIX.length);
    const lp = getLocalPools().find((p) => p.key === key);
    return lp?.createdTx ?? lp?.txHash ?? null;
  }, [poolId]);
  const poolState = usePoolState(
    derived?.tokenA ?? null,
    derived?.tokenB ?? null,
    derived?.fee ?? null,
  );
  const addStatus = computeAddStatus(derived, poolState);

  // Match the user's open positions against this pool by token addresses
  // (canonical order-independent) + fee tier. Two sources:
  //   1. `/api/positions` — Mantua-tracked DB rows + subgraph-discovered
  //      pools. Carries on-chain `token0`/`token1` addresses
  //      and the integer fee.
  //   2. `getUserLocalPositions()` — localStorage breadcrumb of local
  //      mints whose server-side row never landed. Synthesized into a
  //      `Position`-shaped record with `id: ""`; the modal/calldata
  //      flow detects the empty id and falls back to the `tokenId`
  //      remove path on the server.
  const matchingPositions = useMemo<Position[]>(() => {
    if (!derived) return [];
    const addrA = TOKENS[derived.tokenA].address.toLowerCase();
    const addrB = TOKENS[derived.tokenB].address.toLowerCase();
    const fromApi = (positions.data ?? []).filter((p) => {
      if (p.status !== "open") return false;
      if (p.fee !== derived.fee) return false;
      const t0 = p.token0.toLowerCase();
      const t1 = p.token1.toLowerCase();
      return (t0 === addrA && t1 === addrB) || (t0 === addrB && t1 === addrA);
    });
    if (IS_MAINNET) return fromApi;

    const knownTokenIds = new Set(
      fromApi.map((p) => p.tokenId).filter((id): id is string => id !== null),
    );
    // Source positions on-chain (authoritative — survives cache clears and
    // catches positions opened anywhere), unioned with fresh mint
    // breadcrumbs so a just-added position shows without waiting out RPC
    // lag; breadcrumbs alone while the fetch is in flight. Both share the
    // LocalPosition shape, so the same adapter + match works for either.
    const source = mergeWithFreshBreadcrumbs(onchainPositions.data, getUserLocalPositions());
    const fromOnchain: Position[] = source
      .filter((lp) => {
        if (lp.fee !== derived.fee) return false;
        return (
          (lp.tokenA === derived.tokenA && lp.tokenB === derived.tokenB) ||
          (lp.tokenA === derived.tokenB && lp.tokenB === derived.tokenA)
        );
      })
      .filter((lp) => !knownTokenIds.has(lp.tokenId))
      .map(localPositionToPosition);
    return [...fromApi, ...fromOnchain];
  }, [positions.data, derived, onchainPositions.data]);

  // Removing liquidity is a single flow: one "Remove liquidity" action that
  // opens the modal for the user's position in this pool (the modal burns/
  // decreases the position and returns BOTH tokens in one transaction).
  // Pick the most recent removable position (on-chain rows are newest-first;
  // a missing tokenId can't be removed).
  const removablePosition = useMemo<Position | null>(
    () => matchingPositions.find((p) => p.tokenId !== null) ?? null,
    [matchingPositions],
  );

  return (
    <>
      <PanelHeader />
      <PanelSubHeader
        title={data ? normalizePairSymbol(data.pool.symbol) : "Loading…"}
        {...(data?.pool.feeTier ? { subtitle: data.pool.feeTier } : {})}
        onBack={onBack}
        {...(onClose ? { onClose } : {})}
      />

      {loading && <p className="px-5 py-8 text-xs text-text-dim text-center">Loading pool…</p>}
      {error && (
        <p className="px-5 py-8 text-xs text-red text-center">
          Failed to load pool: {error.message}
        </p>
      )}

      {data && (
        <div className="flex-1 overflow-auto px-5 pt-2 pb-5 space-y-5">
          <Stats
            tvl={data.pool.tvlUsd}
            apy={data.pool.apy}
            vol24={data.pool.volumeUsd1d}
            vol7d={data.pool.volumeUsd7d}
          />

          {creationTx && (
            <a
              href={`${EXPLORER}/tx/${creationTx}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-text-dim hover:text-accent"
            >
              Pool created — view transaction <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}

          <div className="flex items-center justify-between">
            <RangeToggle value={range} onChange={setRange} />
            <MetricToggle value={metric} onChange={setMetric} />
          </div>

          <TvlChart points={data.chart} metric={metric} />

          {/* Pair performance — exchange rate of the pair over the selected
              range (tokenB priced in tokenA), from reference price history. */}
          {derived && (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <div className="text-[11px] font-semibold tracking-[0.12em] text-text-mute uppercase">
                  Pair price
                </div>
                <div className="text-[11px] text-text-dim">
                  {derived.tokenB}/{derived.tokenA}
                </div>
              </div>
              {pairChart.error ? (
                <p className="py-8 text-xs text-text-mute text-center">
                  Price history unavailable right now.
                </p>
              ) : pairChart.points.length === 0 ? (
                <p className="py-8 text-xs text-text-dim text-center">
                  {pairChart.loading ? "Loading price history…" : "No price history for this pair."}
                </p>
              ) : (
                <PairRateChart points={pairChart.points} />
              )}
            </div>
          )}

          <div className="space-y-2">
            <Button
              variant="primary"
              size="md"
              disabled={!addStatus.enabled}
              onClick={() => {
                if (addStatus.enabled && derived) {
                  onAddLiquidity(
                    localHook === undefined ? derived : { ...derived, hook: localHook },
                  );
                }
              }}
              className="w-full"
            >
              {addStatus.label}
            </Button>
            {addStatus.hint && (
              <p className="text-[11px] text-text-mute text-center">{addStatus.hint}</p>
            )}
            {/* Single remove flow: one action that opens the modal to pull
                BOTH tokens out of this pool in one transaction. */}
            {removablePosition && (
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setRemoving(removablePosition);
                }}
                className="w-full"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove liquidity
              </Button>
            )}
          </div>

          <RemoveLiquidityModal
            position={removing}
            onClose={() => {
              setRemoving(null);
            }}
            onSuccess={() => {
              setRemoving(null);
              positions.reload();
              onchainPositions.refetch();
            }}
          />

          {data.pool.underlyingTokens.length > 0 && (
            <div className="text-xs text-text-mute space-y-1">
              <p className="uppercase tracking-wider text-[10px]">Underlying</p>
              {data.pool.underlyingTokens.map((addr) => (
                <a
                  key={addr}
                  href={`${EXPLORER}/address/${addr}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-text-dim hover:text-accent inline-flex items-center gap-1"
                >
                  {addr.slice(0, 6)}…{addr.slice(-4)} <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Stats({
  tvl,
  apy,
  vol24,
  vol7d,
}: {
  tvl: number;
  apy: number;
  vol24: number;
  vol7d: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCell label="TVL" value={formatUsd(tvl)} />
      <StatCell label="APY" value={formatPct(apy)} />
      <StatCell label="Volume 24h" value={formatUsd(vol24)} />
      <StatCell label="Volume 7d" value={formatUsd(vol7d)} />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-elev rounded-sm p-3">
      <div className="text-[10px] uppercase tracking-wider text-text-mute">{label}</div>
      <div className="text-base font-mono mt-1">{value}</div>
    </div>
  );
}

interface AddStatus {
  enabled: boolean;
  label: string;
  hint: string | null;
}

function computeAddStatus(
  derived: ReturnType<typeof tryDeriveAddCtx>,
  poolState: ReturnType<typeof usePoolState>,
): AddStatus {
  if (!derived) {
    return {
      enabled: false,
      label: "Add liquidity",
      hint: "Pair not in Mantua's supported token set yet.",
    };
  }
  if (poolState.loading) return { enabled: false, label: "Checking pool…", hint: null };
  if (poolState.error) {
    return { enabled: false, label: "Add liquidity", hint: "Couldn't check pool state." };
  }
  if (!poolState.data?.exists) {
    return {
      enabled: false,
      label: "Add liquidity",
      hint: "No v4 pool at this fee tier — create one from the Liquidity tab.",
    };
  }
  return { enabled: true, label: "Add liquidity", hint: null };
}
