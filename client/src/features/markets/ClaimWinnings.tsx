import { useMemo } from "react";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { usd } from "@/lib/format.ts";
import {
  claimLabel,
  groupClaims,
  isClaimBusy,
  totalClaimableUsd,
  type RedeemableClaim,
} from "./market-redeem-core.ts";
import { useMarketRedeem, useRedeemable } from "./use-market-redeem.ts";

interface Props {
  /** Wallet whose winnings to check. Renders nothing without one. */
  address: string | null | undefined;
  /** When set, only claims for this game are shown (market-detail view). */
  providerEventId?: string;
}

/**
 * "Claim winnings" affordance (C-011 GAP-3): lists the wallet's claimable
 * positions — won markets and voided ones — with the USDC each pays, and a
 * one-click claim per market. Renders nothing when there is nothing to
 * claim, so it costs no space on the happy path.
 *
 * Copy is chainless (B-016): users claim winnings; progress is announced
 * via role="status", failures via role="alert".
 */
export function ClaimWinnings({ address, providerEventId }: Props) {
  const { rows, reload } = useRedeemable(address);
  const { phase, claim } = useMarketRedeem(reload);

  const claims = useMemo<RedeemableClaim[]>(() => {
    const grouped = groupClaims(rows ?? []);
    return providerEventId ? grouped.filter((c) => c.providerEventId === providerEventId) : grouped;
  }, [rows, providerEventId]);

  const busy = isClaimBusy(phase.kind);
  const showStatus = phase.kind !== "idle" && phase.kind !== "error";
  if (!address || (claims.length === 0 && phase.kind === "idle")) return null;

  return (
    <div className="mb-4 rounded-md border border-green/40 bg-green/5">
      <div className="flex items-center gap-2 border-b border-border-soft px-4 py-2.5">
        <Trophy className="h-4 w-4 text-green" />
        <span className="text-[13px] font-semibold">Claim winnings</span>
        {claims.length > 0 && (
          <span className="ml-auto font-mono text-[13px] font-semibold text-green">
            {usd(totalClaimableUsd(claims))}
          </span>
        )}
      </div>

      {claims.map((c) => {
        const mine =
          phase.kind !== "idle" && phase.kind !== "error" && phase.marketId === c.marketId;
        return (
          <div
            key={c.marketId}
            className="flex items-center gap-3 border-b border-border-soft px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{c.label}</div>
              <div className="mt-0.5 text-[11px] text-text-dim">
                {c.state === "INVALID" ? "Voided — your stake comes back" : "Won"}
                {c.league ? ` · ${c.league.toUpperCase()}` : ""}
              </div>
            </div>
            <div className="font-mono text-[13px]">{usd(c.totalUsd)}</div>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => {
                void claim(c.marketId);
              }}
            >
              {mine ? claimLabel(phase.kind) : "Claim winnings"}
            </Button>
          </div>
        );
      })}

      {showStatus && phase.kind !== "done" && (
        <p role="status" className="px-4 py-2 text-[12px] text-text-dim">
          {claimLabel(phase.kind)}
        </p>
      )}
      {phase.kind === "done" && (
        <p role="status" className="px-4 py-2 text-[12px] text-green">
          Winnings claimed — the USDC is in your balance.
        </p>
      )}
      {phase.kind === "error" && (
        <p role="alert" className="px-4 py-2 text-[12px] text-yellow">
          {phase.message}
        </p>
      )}
    </div>
  );
}
