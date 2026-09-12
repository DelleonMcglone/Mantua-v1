import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button.tsx";
import { usdcRawToDollars } from "@/features/portfolio/live-balance-core.ts";
import type { Side } from "../trade-ticket-core.ts";
import type { SlateEvent } from "../use-slate.ts";
import { TicketAmount } from "./TicketAmount.tsx";
import { TicketExecuted } from "./TicketExecuted.tsx";
import { TicketFunding } from "./TicketFunding.tsx";
import { TicketReview } from "./TicketReview.tsx";
import { TicketSides } from "./TicketSides.tsx";
import { TicketStatus } from "./TicketStatus.tsx";
import { useTradeTicket } from "./use-trade-ticket.ts";

/**
 * The trade ticket (task 050): price tap → amount tap → Confirm. Buys and
 * sells before or during the game; the review block shows the hook's exact
 * fee; execution ends in an explicit "Trade executed" card; a short balance
 * offers Add funds inline. No chain vocabulary anywhere on it (T-005).
 */
export function TradeTicket({
  event,
  outcomeIndex,
  onPick,
  onViewPositions,
  initialDirection,
  initialAmount,
}: {
  event: SlateEvent;
  outcomeIndex: Side;
  onPick: (side: Side) => void;
  onViewPositions: () => void;
  initialDirection?: "buy" | "sell" | undefined;
  initialAmount?: string | undefined;
}) {
  const { user } = usePrivy();
  const t = useTradeTicket({ event, outcomeIndex, initialDirection, initialAmount });
  const chosen = outcomeIndex === 0 ? event.home : event.away;
  const login = () => {
    window.dispatchEvent(new Event("mantua:open-login"));
  };
  const executed =
    t.ticket.step === "executed" && t.phase.kind === "done" ? t.phase.calldata : null;

  return (
    <div data-testid="trade-ticket" className="rounded-md border border-border bg-panel-solid p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-[12px] text-text-dim">
            {event.away.name} at {event.home.name}
          </p>
          <p className="text-[15px] font-semibold">{chosen.name}</p>
        </div>
        {t.authenticated && (
          <p data-testid="balance-line" className="text-[11px] text-text-dim">
            Balance <span className="font-mono text-text">{usdcRawToDollars(t.balanceRaw)}</span>
          </p>
        )}
      </div>

      <TicketSides
        event={event}
        side={outcomeIndex}
        direction={t.ticket.direction}
        onPick={onPick}
        onDirection={(d) => {
          t.tap({ kind: "direction", direction: d });
        }}
      />

      {executed ? (
        <TicketExecuted
          calldata={executed}
          direction={t.ticket.direction}
          teamName={chosen.name}
          onViewPositions={onViewPositions}
          onTradeAgain={() => {
            t.tap({ kind: "reset" });
          }}
        />
      ) : (
        <>
          <TicketAmount
            amount={t.ticket.amount}
            direction={t.ticket.direction}
            contractBalance={t.contractBalance}
            onTap={t.tap}
          />
          <TicketReview
            quote={t.quote}
            summary={t.summary}
            lines={t.lines}
            direction={t.ticket.direction}
            teamName={chosen.name}
            quoting={t.phase.kind === "quoting"}
          />
          {t.funding.open && (
            <TicketFunding
              walletAddress={user?.wallet?.address}
              suggestedUsd={t.ticket.amount}
              onClose={t.funding.close}
              onSkip={t.funding.skip}
            />
          )}
          <TicketStatus
            phase={t.phase}
            error={t.error}
            onRetry={() => {
              t.tap({ kind: "reset" });
            }}
            onFund={t.confirm}
            onLogin={login}
          />
          {t.readiness === "login" ? (
            <Button variant="primary" size="lg" className="mt-3 w-full" onClick={login}>
              Log in to trade
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="mt-3 w-full"
              data-testid="confirm"
              aria-live="polite"
              aria-atomic="true"
              disabled={t.busy || t.readiness === "waiting"}
              onClick={t.confirm}
            >
              {t.busy
                ? "Working…"
                : t.readiness === "fund"
                  ? "Add funds"
                  : `Confirm ${t.ticket.direction === "sell" ? "sell" : "buy"}`}
            </Button>
          )}
        </>
      )}

      <p className="mt-3 text-[10.5px] leading-relaxed text-text-mute">
        Trade before or during the game — trading closes when the game goes final. A winning
        contract pays $1; postponed or tied games settle both sides at 50¢. By trading you agree to
        the Terms of Use.
      </p>
    </div>
  );
}
