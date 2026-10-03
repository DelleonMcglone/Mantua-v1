import { Button } from "@/components/ui/button.tsx";
import { CopyButton } from "@/features/agent/agent-primitives.tsx";

/**
 * T-013 — Add funds, woven into the first trade: a USDC transfer to the
 * user's Mantua wallet; Skip returns to the ticket. Nothing here names a
 * chain — the one sanctioned network warning lives on the profile's
 * deposit dialog.
 */
export function TicketFunding({
  walletAddress,
  onClose,
  onSkip,
}: {
  walletAddress: string | undefined;
  onClose: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      data-testid="ticket-funding"
      className="mt-3 rounded-md border border-accent/40 bg-accent/5 p-3 text-[12.5px]"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">Add funds to place this trade</span>
        <button
          type="button"
          onClick={onSkip}
          className="text-[11px] text-text-dim hover:text-text cursor-pointer"
        >
          Skip — I already have USDC
        </button>
      </div>
      <div className="mt-3 space-y-2">
        <p className="text-text-dim">
          Send USDC to your Mantua wallet. It shows up here as soon as it lands.
        </p>
        {walletAddress ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm bg-bg-elev px-2 py-1 font-mono text-[11px]">
              {walletAddress}
            </code>
            <CopyButton value={walletAddress} label="Copy" size={12} />
          </div>
        ) : (
          <p className="text-text-dim">Log in to see your deposit address.</p>
        )}
        <Button variant="ghost" size="sm" className="border-border-soft" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
