import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useLegalAcceptance } from "@/features/legal/use-legal-acceptance.ts";
import { TicketAction } from "@/features/markets/ticket/TicketAction.tsx";
import { TicketAmount } from "@/features/markets/ticket/TicketAmount.tsx";
import { TicketFunding } from "@/features/markets/ticket/TicketFunding.tsx";
import { TicketStatus } from "@/features/markets/ticket/TicketStatus.tsx";
import { usePendingTrades } from "@/features/markets/PendingTradesProvider.tsx";
import { ComboExecuted } from "./ComboExecuted.tsx";
import { ComboLegsList } from "./ComboLegsList.tsx";
import { ComboLimitsForm } from "./ComboLimitsForm.tsx";
import { ComboReview } from "./ComboReview.tsx";
import { comboDraft } from "./combo-draft.ts";
import { useComboBuilder } from "./use-combo-builder.ts";

/**
 * Task 072 / CB-002 — the Combo Builder: legs picked from any league page,
 * a stake, the review (payout, odds, fee lines), one Confirm. The same
 * ticket pieces the single-trade ticket uses — amount row, funding sheet,
 * status banner, action slot — so a combo trades like a trade.
 */
export function ComboBuilder({ onClose, onBrowse }: { onClose: () => void; onBrowse: () => void }) {
  const b = useComboBuilder();
  const register = usePendingTrades();
  const legal = useLegalAcceptance();

  return (
    <>
      <PanelHeader />
      <PanelSubHeader
        title="Combo"
        subtitle="Several teams, one ticket — every leg must win"
        onClose={onClose}
      />
      <div className="flex-1 overflow-auto px-5 pb-6">
        <div
          data-testid="combo-builder"
          className="rounded-md border border-border bg-panel-solid p-4"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[15px] font-semibold">
              {b.legs.length === 0 ? "Build a combo" : `${String(b.legs.length)}-leg combo`}
            </p>
            <Button variant="ghost" size="sm" onClick={onBrowse}>
              Add legs from a league
            </Button>
          </div>
          <ComboLegsList
            legs={b.legs}
            quoted={b.quote?.legs ?? []}
            onRemove={(leg) => {
              comboDraft.remove(leg);
            }}
          />
          {b.executed ? (
            <ComboExecuted
              calldata={b.executed.calldata}
              recorded={b.executed.recorded}
              onReset={() => {
                comboDraft.clear();
                b.trade.reset();
              }}
            />
          ) : (
            <>
              <TicketAmount
                amount={b.stake}
                direction="buy"
                contractBalance={null}
                onTap={(t) => {
                  if (t.kind === "type") b.setStake(t.amount);
                  if (t.kind === "preset") b.setStake(String(t.amount));
                }}
              />
              <ComboReview quote={b.quote} quoting={b.quoting} />
              {b.funding.open && (
                <TicketFunding
                  walletAddress={b.walletAddress}
                  suggestedUsd={b.stake}
                  onClose={b.funding.close}
                  onSkip={b.funding.skip}
                />
              )}
              <TicketStatus
                phase={b.trade.phase}
                error={b.error}
                earlier={{
                  pending: [],
                  settled: [],
                  slow: register.slow,
                  dismiss: register.dismiss,
                }}
                onRetry={b.trade.reset}
                onFund={b.confirm}
                onLogin={b.login}
              />
              <TicketAction
                readiness={b.readiness}
                busy={b.busy}
                direction="buy"
                legal={legal}
                onLogin={b.login}
                onConfirm={b.confirm}
              />
            </>
          )}
          <p className="mt-3 text-[10.5px] leading-relaxed text-text-mute">
            A combo is its own market: one trade, one position that pays $1 a share only if every
            leg wins. A voided game drops out; if every leg is voided the ticket settles at 50¢. You
            can sell the position back before it settles.
          </p>
        </div>
        {b.authenticated && <ComboLimitsForm />}
      </div>
    </>
  );
}
