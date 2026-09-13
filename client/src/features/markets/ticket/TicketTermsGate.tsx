import { Button } from "@/components/ui/button.tsx";

/**
 * Task 067 (G-014) — the one-time Terms gate in place of the Confirm
 * button: shown to a signed-in user who has not accepted the current
 * Terms. One tap records the acceptance server-side; the ticket then
 * shows Confirm. The document itself opens in the legal page.
 */
export function TicketTermsGate({
  accepting,
  error,
  onAccept,
}: {
  accepting: boolean;
  error: string | null;
  onAccept: () => void;
}) {
  const openTerms = () => {
    window.dispatchEvent(new CustomEvent("mantua:open-legal", { detail: "terms" }));
  };
  return (
    <div
      data-testid="terms-gate"
      className="mt-3 rounded-md border border-border-soft p-3 text-[12.5px]"
    >
      <p className="text-text-dim">
        Before your first trade, please read and accept the{" "}
        <button type="button" onClick={openTerms} className="underline text-text cursor-pointer">
          Terms of Use
        </button>
        . They cover fees, how markets settle, and what happens when a game is postponed.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-yellow">
          {error}
        </p>
      )}
      <Button
        variant="primary"
        size="lg"
        className="mt-3 w-full"
        data-testid="accept-terms"
        disabled={accepting}
        onClick={onAccept}
      >
        {accepting ? "Saving…" : "I agree to the Terms of Use"}
      </Button>
    </div>
  );
}
