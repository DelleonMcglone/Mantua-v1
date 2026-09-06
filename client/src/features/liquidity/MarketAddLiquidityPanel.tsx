import { useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { useConfirmedAction } from "@/hooks/use-confirmed-action.tsx";
import { BASE_CHAIN_ID, getExplorerTxUrl } from "@/lib/chains.ts";
import { addCtaLabel } from "./add-helpers.ts";
import { isMarketGatedError, useAddLiquidity } from "./use-add-liquidity.ts";
import { useMarketPools } from "./use-market-pools.ts";
import type { MarketLiquidityTarget } from "./market-pools.ts";

interface Props {
  market: MarketLiquidityTarget;
  onBack: () => void;
  onClose?: () => void;
}

const GATED_COPY =
  "Market pools aren't live yet. Liquidity for game markets opens once the " +
  "Dynamic Market pools are deployed on-chain — check back soon.";

/** Parse a human amount into raw 6dp units (YES and USDC are both 6dp). */
function toRaw6(value: string): string {
  const num = parseFloat(value);
  if (!Number.isFinite(num) || num <= 0) return "0";
  return String(Math.round(num * 1e6));
}

/**
 * B7-004 — the liquidity surface's market-pool mode: add liquidity to one
 * game outcome's YES/USDC pool on the Dynamic Market stack. Rendered by
 * AddLiquidityForm when its context carries a market target.
 *
 * The state that matters today: with no Dynamic Market deployment the
 * whole surface is GATED — a polite `role="status"` explanation and a
 * disabled CTA (B-016 conventions: non-error states announce politely;
 * errors announce with `role="alert"`). A gated server response (409,
 * `gated: true`) renders the same copy, never an opaque failure.
 */
export function MarketAddLiquidityPanel({ market, onBack, onClose }: Props) {
  const chainId = BASE_CHAIN_ID;
  const marketPools = useMarketPools();
  const [amountYes, setAmountYes] = useState("0.0");
  const [amountUsdc, setAmountUsdc] = useState("0.0");
  const confirm = useConfirmedAction();
  const add = useAddLiquidity();

  const deployed = marketPools.data?.marketsDeployed === true;
  const yesLabel = market.label ? `${market.label} YES` : "YES";
  const amountYesRaw = toRaw6(amountYes);
  const amountUsdcRaw = toRaw6(amountUsdc);
  const ready = deployed && amountYesRaw !== "0" && amountUsdcRaw !== "0";

  async function onSubmit() {
    if (!ready) return;
    const ok = await confirm({
      title: `Add liquidity · ${yesLabel} / USDC`,
      description: `${amountYes} ${yesLabel} + ${amountUsdc} USDC · Dynamic Market pool`,
      confirmLabel: "Sign in wallet",
    });
    if (!ok) return;
    await add.executeMarket({
      market: { providerEventId: market.providerEventId, outcomeIndex: market.outcomeIndex },
      amountYesRaw,
      amountUsdcRaw,
      slippageBps: 50,
    });
  }

  const gatedByServer = add.state.status === "error" && isMarketGatedError(add.state.error);

  return (
    <>
      <PanelHeader />
      <PanelSubHeader
        title="Market Pool Liquidity"
        subtitle={market.event ?? "Provide liquidity to a game market's YES/USDC pool."}
        {...(onClose ? { onClose } : {})}
      />

      <div className="flex-1 overflow-auto px-5 pt-2 pb-5">
        {/* Pair header */}
        <div className="flex items-center gap-2.5 mb-3.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="h-7 w-7 inline-flex items-center justify-center rounded-xs border border-border-soft bg-transparent text-text-dim hover:text-text"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div className="text-[14px] font-semibold">{yesLabel} / USDC</div>
          <span className="px-1.5 py-px rounded-[6px] text-[10px] font-medium tracking-[0.04em] bg-chip text-text-mute border border-border-soft uppercase">
            Dynamic Market
          </span>
        </div>

        {marketPools.loading ? (
          <EmptyState>Checking market pool availability…</EmptyState>
        ) : !deployed ? (
          // The gated state (B7-004): informational, not an error — the
          // user did nothing wrong. EmptyState announces it politely.
          <EmptyState className="py-10">{GATED_COPY}</EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MarketAmountCard label={yesLabel} amount={amountYes} onChange={setAmountYes} />
              <MarketAmountCard label="USDC" amount={amountUsdc} onChange={setAmountUsdc} />
            </div>
            <p className="text-[11px] text-text-dim mt-3">
              Full-range position on the market&apos;s YES/USDC pool. Fees are dynamic — set by
              the Dynamic Market hook per swap.
            </p>
          </>
        )}

        {/* CTA */}
        <Button
          variant="primary"
          size="lg"
          aria-live="polite"
          aria-atomic="true"
          disabled={
            !ready ||
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
          {!deployed
            ? "Market pools not live yet"
            : ready
              ? addCtaLabel(add.state)
              : "Enter amounts"}
        </Button>

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
        {add.state.status === "error" &&
          add.state.error &&
          // A gated 409 that raced past the pre-check renders the same
          // gate copy — with role="alert" since it arrives as an error
          // response after an action (B-016).
          (gatedByServer ? (
            <p role="alert" className="text-xs text-amber text-center mt-3">
              {GATED_COPY}
            </p>
          ) : (
            <p role="alert" className="text-xs text-red text-center mt-3">
              {add.state.error.message}
            </p>
          ))}
      </div>
    </>
  );
}

function MarketAmountCard({
  label,
  amount,
  onChange,
}: {
  label: string;
  amount: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="bg-bg-elev border border-border-soft rounded-md px-3.5 py-3">
      <div className="text-[11px] text-text-dim">{label}</div>
      <input
        inputMode="decimal"
        aria-label={`${label} amount`}
        value={amount}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder="0.0"
        className="w-full mt-1 bg-transparent border-none outline-none p-0 font-mono text-[24px] tracking-[-0.01em] text-text"
      />
    </div>
  );
}
