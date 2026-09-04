import { useMemo, useState } from "react";
import { ArrowLeft, ArrowUp, ExternalLink, RefreshCw } from "lucide-react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import { usd as formatUsd } from "@/lib/format.ts";
import { useConfirmedAction } from "@/hooks/use-confirmed-action.tsx";
import { BASE_CHAIN_ID, getExplorerTxUrl, type SupportedChainId } from "@/lib/chains.ts";
import { type TokenSymbol } from "@/lib/tokens.ts";
import { TokenSelector } from "@/features/swap/TokenSelector.tsx";
import { FEE_TIER_LABELS, type FeeTier } from "./fee-tiers.ts";
import { TokenPairIcon } from "./TokenPairIcon.tsx";
import { safeParse } from "./create-helpers.ts";
import { addCtaLabel } from "./add-helpers.ts";
import { useAddLiquidity } from "./use-add-liquidity.ts";
import type { HookName } from "./use-create-pool.ts";
import {
  HOOK_DESCRIPTIONS,
  HOOK_LABELS,
  feeForHook,
  hookCompatibilityError,
  recommendedHookForPair,
} from "./hook-recommendations.ts";
import { useTokenPrices } from "./use-token-prices.ts";
import { usePairPriceChart } from "./use-pair-price-chart.ts";
import { PairRateChart } from "./PairRateChart.tsx";

export interface PoolKeyContext {
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  /** Hook bound to the pool. Required for hook-managed pools so the
   *  reconstructed PoolKey matches on-chain (Stable Protection / Dynamic
   *  Fee pools have `key.fee = DYNAMIC_FEE_FLAG`). Null = no-hook pool. */
  hook?: HookName | null;
  /** Set by the pool-create flow with the just-initialized price.
   *  Omitted when entering from PoolDetailPage — server reads slot0. */
  sqrtPriceX96?: string;
  /** True when the form was opened against a known existing pool —
   *  locks the pair / fee / hook controls so the user can't drift away
   *  from the pool they're trying to deposit into. */
  locked?: boolean;
  /** Deposit amounts to pre-fill, parsed from a chat command like
   *  "add $10 USDC / $10 cbBTC". Omitted = start at 0. */
  amountA?: string;
  amountB?: string;
}

interface Props {
  /** Initial pair / fee / hook to pre-fill. Omit to start from defaults
   *  (USDC/EURC + 0.01% + Stable Protection) — the form will then act
   *  as a unified "create or add" surface. */
  ctx?: PoolKeyContext;
  onBack: () => void;
  onClose?: () => void;
}

function defaultPairForChain(chainId: SupportedChainId): [TokenSymbol, TokenSymbol] {
  void chainId;
  // Defaults to USDC/EURC so the Stable Protection
  // recommendation lights up.
  return ["USDC", "EURC"];
}

function formatMirror(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

const RANGE_OPTIONS = ["Full", "Wide", "Narrow", "Custom"] as const;
type RangeOption = (typeof RANGE_OPTIONS)[number];

const CHART_RANGES = ["1D", "7D", "30D"] as const;
type ChartRange = (typeof CHART_RANGES)[number];

/**
 * Add-Liquidity panel — implements `AddLiquidityPanel` from
 * `mantua-ai/project/src/panels.jsx:266`. Layout:
 *
 *   inline pair header (back + token pair + hook badge) ·
 *   "Fee · TVL · APY" stats row ·
 *   pair-price label + range toggle (1D/7D/30D) + price chart ·
 *   two TokenInput cards with flip button ·
 *   LIQUIDITY HOOK dropdown + PRICE RANGE toggle ·
 *   Fee Tier · Hook Benefit · Review & Sign Position
 *
 * Backed by the same `useAddLiquidity` wiring as before — the layout
 * change is presentational; calldata + approvals path is unchanged.
 */
export function AddLiquidityForm({ ctx, onBack, onClose }: Props) {
  const chainId = BASE_CHAIN_ID;
  const locked = ctx?.locked === true;
  const [defaultA, defaultB] = defaultPairForChain(chainId);
  const [tokenA, setTokenA] = useState<TokenSymbol>(ctx?.tokenA ?? defaultA);
  const [tokenB, setTokenB] = useState<TokenSymbol>(ctx?.tokenB ?? defaultB);
  // The fee tier is auto-assigned by the chosen hook. Every supported pair
  // can be created with its recommended hook OR with no hook (a plain
  // pool), via the toggle below:
  //   USDC/EURC          → Stable Protection | No Hook
  //   USDC|EURC / cbBTC  → Dynamic Fee       | No Hook
  // `useHook` defaults to on, so the recommended hook is the default.
  const pairHook = useMemo(
    () => recommendedHookForPair(tokenA, tokenB, chainId),
    [tokenA, tokenB, chainId],
  );
  // When locked onto an existing pool, honor that pool's actual hook
  // (ctx.hook is null for no-hook pools). Otherwise (create / chat flows)
  // default the recommended hook on, preserving prior behavior.
  const [useHook, setUseHook] = useState(locked ? ctx.hook != null : true);
  const hook: HookName | "none" = useMemo(
    () => (pairHook && useHook ? pairHook : "none"),
    [pairHook, useHook],
  );
  // Fee tier follows the pool that actually exists on-chain: USDC/EURC
  // Stable Protection → 0.01%; cbBTC Dynamic Fee → 0.05% (the funded,
  // correct-price pools); Volatile (no-hook) → 0.30%.
  const fee: FeeTier = useMemo(() => feeForHook(hook === "none" ? null : hook), [hook]);

  // Chain-switch handling lives in the parent: App.tsx keys this component
  // on `chainId`, so a network change remounts the form and the useState
  // initializers re-run with `defaultPairForChain(chainId)`.
  const [amountA, setAmountA] = useState(ctx?.amountA ?? "0.0");
  const [amountB, setAmountB] = useState(ctx?.amountB ?? "0.0");
  const [chartRange, setChartRange] = useState<ChartRange>("7D");
  const [range, setRange] = useState<RangeOption>("Full");
  const confirm = useConfirmedAction();
  const add = useAddLiquidity();

  // Mirror Token A ↔ Token B at the live USD price ratio so users
  // type once. Stable-stable pairs fall back to 1:1; pairs with no
  // available ratio (CoinGecko 4xx, etc.) leave the other side alone.
  const tokenPrices = useTokenPrices(useMemo(() => [tokenA, tokenB], [tokenA, tokenB]));
  const priceRatioAtoB = useMemo(() => {
    // Mirror at the real market ratio for every hook. Stable Protection is now
    // FX-aware (its breaker anchors to a live EUR/USD reference), so USDC/EURC
    // opens at ~market — no more forced 1:1, which would trip the FX-aware hook.
    const pa = tokenPrices.prices[tokenA];
    const pb = tokenPrices.prices[tokenB];
    if (pa && pb && pa > 0 && pb > 0) return pa / pb;
    return null;
  }, [tokenPrices.prices, tokenA, tokenB]);

  // Real pair exchange-rate history (tokenB priced in tokenA) for the price
  // chart, driven by the range toggle. Reference prices from DefiLlama since
  // locally-created pools have no index of their own.
  const pairChart = usePairPriceChart(tokenA, tokenB, chartRange);

  function onAmountAChange(value: string) {
    setAmountA(value);
    if (priceRatioAtoB === null) return;
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return;
    setAmountB(formatMirror(num * priceRatioAtoB));
  }
  function onAmountBChange(value: string) {
    setAmountB(value);
    if (priceRatioAtoB === null) return;
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return;
    setAmountA(formatMirror(num / priceRatioAtoB));
  }

  const amountARaw = safeParse(tokenA, amountA);
  const amountBRaw = safeParse(tokenB, amountB);
  const hookName: HookName | null = hook === "none" ? null : hook;
  const hookIncompatible = hookCompatibilityError(tokenA, tokenB, hookName, chainId);
  const ready =
    tokenA !== tokenB && amountARaw !== "0" && amountBRaw !== "0" && hookIncompatible === null;
  const hookSummary = hook === "none" ? "No Hook" : HOOK_LABELS[hook];
  const hookDesc = hook === "none" ? "No hook — standard execution" : HOOK_DESCRIPTIONS[hook];

  async function onSubmit() {
    if (!ready) return;
    const ok = await confirm({
      title: `Create / add liquidity · ${tokenA}/${tokenB} · ${hookSummary}`,
      description: `${amountA} ${tokenA} + ${amountB} ${tokenB} · fee ${FEE_TIER_LABELS[fee]} · range ${range}`,
      confirmLabel: "Sign in wallet",
    });
    if (!ok) return;
    await add.execute({
      tokenA,
      tokenB,
      fee,
      hook: hookName,
      amountARaw,
      amountBRaw,
      ...(ctx?.sqrtPriceX96 ? { sqrtPriceX96: ctx.sqrtPriceX96 } : {}),
      slippageBps: 50,
    });
  }

  function flip() {
    const a = amountA;
    setAmountA(amountB);
    setAmountB(a);
  }

  return (
    <>
      <PanelHeader />
      <PanelSubHeader
        title="Create Pool"
        subtitle="Explore and manage your liquidity positions."
        {...(onClose ? { onClose } : {})}
      />

      <div className="flex-1 overflow-auto px-5 pt-2 pb-5">
        {/* Inline pair header */}
        <div className="flex items-center gap-2.5 mb-2.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="h-7 w-7 inline-flex items-center justify-center rounded-xs border border-border-soft bg-transparent text-text-dim hover:text-text"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <TokenPairIcon a={tokenA} b={tokenB} size={22} />
          <div className="text-[14px] font-semibold">
            {tokenA} / {tokenB}
          </div>
          <span className="px-1.5 py-px rounded-[6px] text-[10px] font-medium tracking-[0.04em] bg-chip text-text-mute border border-border-soft uppercase">
            {hookSummary}
          </span>
        </div>

        {/* Mini stats row */}
        <div className="flex gap-3.5 text-[12px] text-text-dim mb-3.5">
          <span className="text-green inline-flex items-center gap-0.5">
            ↗ {feeTierToPct(FEE_TIER_LABELS[fee])} Fee
          </span>
          <span>TVL — —</span>
          <span>APY — —</span>
        </div>

        {/* Pair price label + range toggle */}
        <div className="flex items-center gap-4 text-[12px] border-b border-border-soft pb-2">
          <span className="text-[11px] text-text-mute">
            {tokenA}/{tokenB} Price
          </span>
          <div className="flex-1" />
          <div className="flex gap-0.5 bg-bg-elev p-0.5 rounded-md border border-border-soft">
            {CHART_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setChartRange(r);
                }}
                className={`px-2 py-1 text-[11px] rounded-xs font-medium ${
                  chartRange === r ? "bg-green/30 text-green" : "bg-transparent text-text-dim"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Chart — real pair exchange rate over the selected range. */}
        <div className="mt-2.5">
          {pairChart.error ? (
            <p className="h-32 flex items-center justify-center text-[11px] text-text-mute">
              Price history unavailable right now.
            </p>
          ) : pairChart.points.length === 0 ? (
            <p className="h-32 flex items-center justify-center text-[11px] text-text-dim">
              {pairChart.loading ? "Loading price history…" : "No price history for this pair."}
            </p>
          ) : (
            <PairRateChart points={pairChart.points} height="h-32" />
          )}
        </div>

        {/* Token inputs + flip button */}
        <div
          className="grid items-stretch mt-4 gap-2"
          style={{ gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)" }}
        >
          <TokenInputCard
            label={tokenA}
            sym={tokenA}
            amount={amountA}
            onAmountChange={onAmountAChange}
            onSymbolChange={locked ? () => undefined : setTokenA}
            disabledSymbol={tokenB}
            usdPrice={tokenPrices.prices[tokenA]}
          />
          <button
            type="button"
            onClick={flip}
            aria-label="Flip token order"
            className="self-center h-7 w-7 inline-flex items-center justify-center rounded-xs border border-border-soft bg-transparent text-text-dim"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <TokenInputCard
            label={tokenB}
            sym={tokenB}
            amount={amountB}
            onAmountChange={onAmountBChange}
            onSymbolChange={locked ? () => undefined : setTokenB}
            disabledSymbol={tokenA}
            usdPrice={tokenPrices.prices[tokenB]}
          />
        </div>

        {/* Hook + Range. The hook (and its fee tier) is auto-assigned by the
            pair — shown read-only, no picker. */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <div className="text-[10px] text-text-mute tracking-[0.08em] mb-1.5 font-semibold">
              LIQUIDITY HOOK
            </div>
            {pairHook && !locked ? (
              // Every hooked pair: choose the recommended hook or no hook.
              <div className="flex gap-1 bg-bg-elev p-0.5 rounded-md border border-border-soft">
                {([true, false] as const).map((on) => (
                  <button
                    key={String(on)}
                    type="button"
                    onClick={() => {
                      setUseHook(on);
                    }}
                    className={`flex-1 py-2 text-[12px] rounded-xs font-medium ${
                      useHook === on ? "bg-chip text-text" : "bg-transparent text-text-dim"
                    }`}
                  >
                    {on ? HOOK_LABELS[pairHook] : "No Hook"}
                  </button>
                ))}
              </div>
            ) : (
              <div className="w-full flex items-center gap-2 px-3 py-2.5 bg-bg-elev border border-border-soft rounded-md text-left">
                <ArrowUp className="h-3.5 w-3.5 text-text-dim" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium">{hookSummary}</div>
                  <div className="text-[11px] text-text-dim">{hookDesc}</div>
                </div>
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] text-text-mute tracking-[0.08em] mb-1.5 font-semibold">
              PRICE RANGE
            </div>
            <div className="flex gap-1 bg-bg-elev p-0.5 rounded-md border border-border-soft">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRange(r);
                  }}
                  className={`flex-1 py-2 text-[12px] rounded-xs font-medium ${
                    range === r ? "bg-chip text-text" : "bg-transparent text-text-dim"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Fee Tier + Hook Benefit */}
        <div className="flex justify-between items-center mt-4 text-[13px]">
          <span className="text-text-dim">Fee Tier</span>
          <span className="font-mono text-text">{FEE_TIER_LABELS[fee]}</span>
        </div>
        <div className="flex justify-between items-center mt-2 text-[13px]">
          <span className="text-text-dim">Hook Benefit</span>
          <span className="text-green">{hookDesc}</span>
        </div>

        {hookIncompatible && (
          <p className="text-xs text-amber text-center mt-3">{hookIncompatible}</p>
        )}

        {/* CTA */}
        <Button
          variant="primary"
          size="lg"
          disabled={
            !ready ||
            add.state.status === "creating-pool" ||
            add.state.status === "pool-pending" ||
            add.state.status === "preparing" ||
            add.state.status === "approving" ||
            add.state.status === "signing" ||
            add.state.status === "pending" ||
            add.state.status === "success"
          }
          onClick={() => {
            void onSubmit();
          }}
          className="w-full mt-5"
        >
          {hookIncompatible
            ? "Hook unavailable for this pair"
            : ready
              ? addCtaLabel(add.state)
              : "Enter amounts"}
        </Button>

        {add.state.poolInitTx && (
          <a
            href={getExplorerTxUrl(chainId, add.state.poolInitTx)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-text-dim hover:text-accent inline-flex items-center gap-1 justify-center mt-3 w-full"
          >
            Pool init tx <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {add.state.approvalTx && (
          <a
            href={getExplorerTxUrl(chainId, add.state.approvalTx)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-text-dim hover:text-accent inline-flex items-center gap-1 justify-center mt-3 w-full"
          >
            Approval tx <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {add.state.txHash && (
          <a
            href={getExplorerTxUrl(chainId, add.state.txHash)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:text-accent-2 inline-flex items-center gap-1 justify-center mt-3 w-full"
          >
            View transaction <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {add.state.status === "success" && (
          <button
            type="button"
            onClick={() => {
              add.reset();
              setAmountA("0.0");
              setAmountB("0.0");
            }}
            className="block mx-auto mt-3 px-3 py-1.5 rounded-xs border border-border bg-transparent text-text-dim text-[12px] cursor-pointer hover:text-text hover:border-text-mute transition-colors"
          >
            Add more liquidity
          </button>
        )}
        {add.state.status === "error" && add.state.error && (
          <p className="text-xs text-red text-center mt-3">{add.state.error.message}</p>
        )}
      </div>
    </>
  );
}

function feeTierToPct(label: string): string {
  const m = /([\d.]+)/.exec(label);
  if (!m) return "0.00%";
  return `${m[1]}%`;
}

interface TokenInputCardProps {
  label: string;
  sym: TokenSymbol;
  amount: string;
  onAmountChange: (s: string) => void;
  onSymbolChange: (s: TokenSymbol) => void;
  disabledSymbol: TokenSymbol;
  /** USD spot price for `sym`. Undefined / 0 when unknown — card
   *  falls back to `≈ $0.00`. */
  usdPrice?: number;
}

function formatUsdApprox(amount: string, price: number | undefined): string {
  const n = parseFloat(amount);
  if (!price || !Number.isFinite(n) || n <= 0) return "≈ $0.00";
  // The 7th USD site (B-015): formats through lib/format.ts like the rest,
  // so the missing-value sentinel and grouping can't drift from it.
  return `≈ ${formatUsd(n * price)}`;
}

function TokenInputCard({
  label,
  sym,
  amount,
  onAmountChange,
  onSymbolChange,
  disabledSymbol,
  usdPrice,
}: TokenInputCardProps) {
  return (
    <div className="bg-bg-elev border border-border-soft rounded-md px-3.5 py-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-text-dim">{label}</span>
        <span className="text-text-mute">Balance: 0.00</span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            onAmountChange(e.target.value);
          }}
          placeholder="0.0"
          className="flex-1 min-w-0 bg-transparent border-none outline-none p-0 font-mono text-[24px] tracking-[-0.01em] text-text"
        />
        <TokenSelector value={sym} onChange={onSymbolChange} disabledSymbol={disabledSymbol} />
      </div>
      <div className="text-[11px] text-text-mute mt-0.5">{formatUsdApprox(amount, usdPrice)}</div>
      <div className="border-t border-dashed border-border-soft mt-2.5 pt-2 flex justify-between text-[11px] text-text-dim">
        <span>Current Price</span>
        <span className="font-mono">$—</span>
      </div>
    </div>
  );
}
