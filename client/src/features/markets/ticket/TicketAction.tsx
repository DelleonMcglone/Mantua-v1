import { Button } from "@/components/ui/button.tsx";
import type { useLegalAcceptance } from "@/features/legal/use-legal-acceptance.ts";
import { TicketTermsGate } from "./TicketTermsGate.tsx";
import type { useTradeTicket } from "./use-trade-ticket.ts";

type Readiness = ReturnType<typeof useTradeTicket>["readiness"];
type Legal = ReturnType<typeof useLegalAcceptance>;

/**
 * The ticket's one action slot (task 050 / task 067): "Log in to trade"
 * when signed out, the one-time Terms gate when the current version has
 * not been accepted (G-014), otherwise Confirm — which also reads
 * "Trading paused" or "Add funds" from the ticket's readiness.
 */
export function TicketAction({
  readiness,
  busy,
  direction,
  legal,
  onLogin,
  onConfirm,
}: {
  readiness: Readiness;
  busy: boolean;
  direction: "buy" | "sell";
  legal: Legal;
  onLogin: () => void;
  onConfirm: () => void;
}) {
  if (readiness === "login") {
    return (
      <Button variant="primary" size="lg" className="mt-3 w-full" onClick={onLogin}>
        Log in to trade
      </Button>
    );
  }
  if (legal.gate === "required") {
    return (
      <TicketTermsGate
        accepting={legal.accepting}
        error={legal.error}
        onAccept={() => {
          void legal.accept();
        }}
      />
    );
  }
  const label = busy
    ? "Working…"
    : readiness === "paused"
      ? "Trading paused"
      : readiness === "fund"
        ? "Add funds"
        : `Confirm ${direction === "sell" ? "sell" : "buy"}`;
  return (
    <Button
      variant="primary"
      size="lg"
      className="mt-3 w-full"
      data-testid="confirm"
      aria-live="polite"
      aria-atomic="true"
      disabled={
        busy || readiness === "waiting" || readiness === "paused" || legal.gate === "loading"
      }
      onClick={onConfirm}
    >
      {label}
    </Button>
  );
}
