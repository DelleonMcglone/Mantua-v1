import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { fiatStatusClass, fiatStatusLabel } from "./fiat-status.ts";
import { PlaidLinkLauncher } from "./PlaidLinkLauncher.tsx";
import { useFiatRails } from "./use-fiat-rails.ts";

function dollar(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "$0.00";
}

/** Deposit → trade → withdraw. The detailed Plaid, Zero Hash, Circle and Base
 * choreography stays deliberately below the product boundary. */
export function FiatRailsTab() {
  const rails = useFiatRails();
  const [amount, setAmount] = useState("");
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
  const enabled = rails.data?.mode === "sandbox" || rails.data?.mode === "live";

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="text-[14px] font-medium">Cash</div>
        <p className="text-[12px] text-text-dim mt-1">
          Deposit dollars, trade, then withdraw dollars. Your bank details stay with our regulated
          payments partners.
        </p>
      </div>

      {rails.error && (
        <div role="alert" className="text-[12px] text-red">
          {rails.error}
        </div>
      )}
      {!enabled && (
        <div
          role="status"
          className="rounded-sm bg-bg-elev border border-border-soft p-3 text-[12px] text-text-dim"
        >
          Bank transfers are being enabled. You can trade USDC already in your connected wallet.
        </div>
      )}

      {enabled && !rails.data?.bankLinked && !rails.linkToken && (
        <Button
          variant="primary"
          size="md"
          disabled={rails.working}
          onClick={() => {
            // Real Plaid Link when the server offers it; deterministic
            // sandbox link otherwise. Same button, same product words.
            if (rails.data?.plaidReady) void rails.startPlaidLink();
            else void rails.linkBank();
          }}
        >
          {rails.working ? "Connecting…" : "Connect bank account"}
        </Button>
      )}
      {rails.linkToken && (
        <PlaidLinkLauncher
          token={rails.linkToken}
          onSuccess={(publicToken) => {
            void rails.completePlaidLink(publicToken);
          }}
          onExit={rails.cancelPlaidLink}
        />
      )}

      {enabled && rails.data?.bankLinked && (
        <>
          {rails.data.bankLabel && (
            <p className="text-[12px] text-text-dim">Connected to {rails.data.bankLabel}.</p>
          )}
          <div className="flex gap-2">
            <Input
              aria-label="Dollar amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
              disabled={rails.working}
              className="border border-border-soft bg-bg-elev rounded-sm text-[15px] font-mono px-2 h-9"
            />
            <Button
              variant="primary"
              size="md"
              disabled={!amountValid || rails.working}
              onClick={() => {
                void rails.move("deposit", amount).then(() => {
                  setAmount("");
                });
              }}
            >
              Deposit
            </Button>
            <Button
              variant="ghost"
              size="md"
              disabled={!amountValid || rails.working}
              onClick={() => {
                void rails.move("withdraw", amount).then(() => {
                  setAmount("");
                });
              }}
            >
              Withdraw
            </Button>
          </div>
          {rails.data.mode === "sandbox" && (
            <p className="text-[11px] text-text-mute">Sandbox mode — no money moves.</p>
          )}
        </>
      )}

      <div className="border-t border-border-soft pt-3">
        <div className="text-[12px] font-medium">Already have USDC?</div>
        <p className="text-[12px] text-text-dim mt-1">
          Trade it directly from your connected wallet. No bank connection is required.
        </p>
      </div>

      {rails.data?.transfers.length ? (
        <div className="border-t border-border-soft pt-3 space-y-2" aria-live="polite">
          <div className="text-[11px] uppercase tracking-wide text-text-mute">Activity</div>
          {rails.data.transfers.map((transfer) => (
            <div key={transfer.id} className="flex justify-between gap-4 text-[12px]">
              <div>
                <span className="capitalize">{transfer.kind}</span> {dollar(transfer.amountUsd)}
                <div className="text-text-mute mt-0.5">{transfer.message}</div>
                {transfer.status === "failed" && transfer.recoveryAction === "retry" && (
                  <button
                    type="button"
                    className="mt-1 text-accent hover:text-accent-2"
                    disabled={rails.working}
                    onClick={() => {
                      void rails.move(transfer.kind, transfer.amountUsd);
                    }}
                  >
                    Try again
                  </button>
                )}
              </div>
              <span className={fiatStatusClass(transfer.status)}>
                {fiatStatusLabel(transfer.status)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
