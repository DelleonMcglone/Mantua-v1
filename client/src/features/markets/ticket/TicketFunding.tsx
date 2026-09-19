import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { CopyButton } from "@/features/agent/agent-primitives.tsx";
import { useFiatRails } from "@/features/portfolio/use-fiat-rails.ts";

// Task 071 (MX-006) — the bank-connection SDK loads with the first deposit.
const PlaidLinkLauncher = lazy(() =>
  import("@/features/portfolio/PlaidLinkLauncher.tsx").then((m) => ({
    default: m.PlaidLinkLauncher,
  })),
);

/**
 * T-013 — Add funds, woven into the first trade. Bank connect + deposit
 * through the shipped Plaid rail, or a USDC transfer for users who already
 * hold it; Skip returns to the ticket. Nothing here names a chain — the
 * one sanctioned network warning lives on the profile's deposit dialog.
 */
export function TicketFunding({
  walletAddress,
  suggestedUsd,
  onClose,
  onSkip,
}: {
  walletAddress: string | undefined;
  suggestedUsd: string;
  onClose: () => void;
  onSkip: () => void;
}) {
  const rails = useFiatRails();
  const [amount, setAmount] = useState(suggestedUsd);
  const [tab, setTab] = useState<"bank" | "usdc">("bank");
  const bankEnabled = rails.data?.mode === "sandbox" || rails.data?.mode === "live";
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;

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
      <div className="mt-2 flex gap-3 border-b border-border-soft text-[12px]">
        {(["bank", "usdc"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
            }}
            className={`pb-1.5 cursor-pointer ${tab === t ? "border-b-2 border-text font-semibold text-text" : "text-text-dim"}`}
          >
            {t === "bank" ? "From your bank" : "Send USDC"}
          </button>
        ))}
      </div>
      {tab === "bank" && (
        <div className="mt-3 space-y-2">
          {!bankEnabled && (
            <p className="text-text-dim">
              Bank transfers are being enabled. You can send USDC instead.
            </p>
          )}
          {bankEnabled && !rails.data?.bankLinked && !rails.linkToken && (
            <Button
              variant="primary"
              size="sm"
              disabled={rails.working}
              onClick={() => {
                if (rails.data?.plaidReady) void rails.startPlaidLink();
                else void rails.linkBank();
              }}
            >
              {rails.working ? "Connecting…" : "Connect bank account"}
            </Button>
          )}
          {rails.linkToken && (
            <Suspense fallback={null}>
              <PlaidLinkLauncher
                token={rails.linkToken}
                onSuccess={(publicToken) => {
                  void rails.completePlaidLink(publicToken);
                }}
                onExit={rails.cancelPlaidLink}
              />
            </Suspense>
          )}
          {bankEnabled && rails.data?.bankLinked && (
            <div className="flex gap-2">
              <Input
                aria-label="Deposit amount in dollars"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                }}
                className="h-9 rounded-sm border border-border-soft bg-bg-elev px-2 font-mono text-[14px]"
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!amountValid || rails.working}
                onClick={() => {
                  void rails.move("deposit", amount).then(onClose);
                }}
              >
                Deposit
              </Button>
            </div>
          )}
          {rails.error && (
            <p role="alert" className="text-red">
              {rails.error}
            </p>
          )}
        </div>
      )}
      {tab === "usdc" && (
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
      )}
    </div>
  );
}
