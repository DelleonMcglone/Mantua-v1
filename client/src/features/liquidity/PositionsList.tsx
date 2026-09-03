import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import { BASE_CHAIN_ID, getExplorerTxUrl } from "@/lib/chains.ts";
import { IS_MAINNET } from "@/lib/tokens.ts";
import { usePortfolio } from "@/features/portfolio/use-portfolio.ts";
import { useOnchainPositions } from "@/features/portfolio/use-onchain-positions.ts";
import { FEE_TIER_LABELS } from "./fee-tiers.ts";
import { isFeeTier } from "./fee-tiers-helpers.ts";
import { getUserLocalPositions, mergeWithFreshBreadcrumbs } from "./local-positions.ts";
import { localPositionToPosition } from "./position-adapters.ts";
import { RemoveLiquidityModal } from "./RemoveLiquidityModal.tsx";
import { tokenLabelByAddress } from "./token-labels.ts";
import { usePositions } from "./use-positions.ts";
import type { Position } from "./positions-types.ts";

interface Props {
  onClose?: () => void;
}

export function PositionsList({ onClose }: Props = {}) {
  const apiPositions = usePositions();
  const { walletAddress } = usePortfolio();
  const onchain = useOnchainPositions(walletAddress);
  const [removing, setRemoving] = useState<Position | null>(null);

  // Local mode: authoritative on-chain positions (durable; reflects real
  // chain state and survives a cleared localStorage cache), unioned with
  // fresh mint breadcrumbs so a just-added position shows immediately even
  // when the discovery read hits a lagging RPC node; breadcrumbs alone
  // while the fetch is in flight. Mainnet: the DB/subgraph-backed API list.
  const data: Position[] = IS_MAINNET
    ? (apiPositions.data ?? [])
    : mergeWithFreshBreadcrumbs(onchain.data, getUserLocalPositions()).map(localPositionToPosition);
  const loading = IS_MAINNET ? apiPositions.loading : onchain.loading && onchain.data === null;
  const error = IS_MAINNET ? apiPositions.error : null;
  const reload = IS_MAINNET ? apiPositions.reload : onchain.refetch;

  return (
    <>
      <PanelHeader />
      <PanelSubHeader
        title="Your positions"
        subtitle="Open liquidity positions held by your connected wallet."
        {...(onClose ? { onClose } : {})}
      />

      {loading && (
        <p role="status" className="px-5 py-8 text-xs text-text-dim text-center">
          Loading positions…
        </p>
      )}
      {error && (
        <p role="alert" className="px-5 py-8 text-xs text-red text-center">
          Failed to load positions: {error.message}
        </p>
      )}
      {!loading && !error && data.length === 0 && (
        <p className="px-5 py-8 text-xs text-text-dim text-center">
          No open positions. Create a pool and add liquidity to see one here.
        </p>
      )}

      {data.length > 0 && (
        <ul className="flex-1 overflow-auto">
          {data.map((p) => (
            <PositionRow key={p.id || p.tokenId || ""} position={p} onRemove={setRemoving} />
          ))}
        </ul>
      )}

      <RemoveLiquidityModal
        position={removing}
        onClose={() => {
          setRemoving(null);
        }}
        onSuccess={() => {
          setRemoving(null);
          reload();
        }}
      />
    </>
  );
}

function PositionRow({
  position,
  onRemove,
}: {
  position: Position;
  onRemove: (p: Position) => void;
}) {
  const chainId = BASE_CHAIN_ID;
  const sym = `${tokenLabelByAddress(position.token0)}/${tokenLabelByAddress(position.token1)}`;
  const feeLabel = isFeeTier(position.fee)
    ? FEE_TIER_LABELS[position.fee]
    : `${String(position.fee / 10_000)}%`;
  return (
    <li className="px-5 py-3 border-b border-border-soft flex items-center gap-3">
      <div className="flex-1">
        <div className="text-sm font-medium font-mono">{sym}</div>
        <div className="text-[11px] text-text-dim">
          {feeLabel} · token #{position.tokenId ?? "—"} · liquidity{" "}
          {truncateLong(position.liquidity)}
        </div>
        {position.feesLabel && (
          <div className="text-[11px] text-green mt-0.5">Fees earned: {position.feesLabel}</div>
        )}
        {position.openedTx && (
          <a
            href={getExplorerTxUrl(chainId, position.openedTx)}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-text-mute hover:text-accent inline-flex items-center gap-1 mt-1"
          >
            opened tx <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onRemove(position);
        }}
      >
        <Trash2 className="h-3 w-3" /> Remove
      </Button>
    </li>
  );
}

function truncateLong(s: string): string {
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
