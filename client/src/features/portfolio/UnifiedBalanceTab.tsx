import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { BASE_CHAIN_ID, getExplorerTxUrl } from "@/lib/chains.ts";
import { token } from "@/lib/format.ts";
import { useUnifiedBalance } from "./use-unified-balance.ts";

/** USDC amount string → grouped display via the canonical `token` formatter. */
function fmtUsdc(s: string | undefined): string {
  const n = Number(s ?? "0");
  if (!Number.isFinite(n)) return "0";
  return token(n);
}

/** "Arbitrum_One" → "Arbitrum One". */
function chainLabel(name: string): string {
  return name.replace(/_/g, " ");
}

/**
 * Unified Balance (Treasury) tab in the Portfolio card — the agent wallet's
 * consolidated USDC across chains via Circle Gateway. View + deposit (the
 * deposit SOURCE is the agent wallet on Base). Spending out of the unified
 * balance is an Agent command, not part of this tab. This is the app's
 * server-side agent wallet (distinct from the user's connected wallet).
 *
 * `ub` is passed in by AssetsCard (which also derives the tab count from
 * it) so the balance is fetched once, not per-component.
 */
export function UnifiedBalanceTab({ ub }: { ub: ReturnType<typeof useUnifiedBalance> }) {
  const [amount, setAmount] = useState("");

  const depositing = ub.depositState.status === "depositing";
  const amountNum = Number(amount);
  const canDeposit = !depositing && Number.isFinite(amountNum) && amountNum > 0;

  const explorerUrl =
    ub.depositState.explorerUrl ??
    (ub.depositState.txHash ? getExplorerTxUrl(BASE_CHAIN_ID, ub.depositState.txHash) : undefined);

  return (
    <div className="p-4 space-y-3">
      <div className="text-[11px] text-text-mute">
        Consolidate USDC across chains into one balance, accessible anywhere — reduces the working
        capital you tie up per chain. Deposits move USDC from the agent wallet. (Agent treasury ·
        Circle Gateway)
      </div>

      {ub.loading && !ub.data && (
        <div role="status" className="text-[12px] text-text-dim">
          Loading balance…
        </div>
      )}
      {ub.error && (
        <div role="alert" className="text-[12px] text-red">
          {ub.error}
        </div>
      )}

      {ub.data && !ub.data.provisioned && (
        <div className="text-[12px] text-text-dim">
          No agent wallet yet. Open “Create / Manage Agent” to set one up, then deposit USDC here to
          start a unified balance.
        </div>
      )}

      {ub.data?.provisioned && (
        <>
          <div className="bg-bg-elev rounded-sm p-3">
            <div className="text-[10px] uppercase tracking-wider text-text-mute">
              Total unified USDC
            </div>
            <div className="text-[22px] font-mono mt-0.5">{fmtUsdc(ub.data.totalUsdc)}</div>
          </div>

          {ub.data.breakdown && ub.data.breakdown.length > 0 ? (
            <div className="space-y-1">
              {ub.data.breakdown.map((b) => (
                <div key={b.chain} className="flex items-center justify-between text-[12px]">
                  <span className="text-text-dim">{chainLabel(b.chain)}</span>
                  <span className="font-mono">{fmtUsdc(b.amount)} USDC</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-text-mute">
              No funds in the unified balance yet — deposit to get started.
            </div>
          )}

          {/* Deposit */}
          <div className="flex items-center gap-2 pt-1">
            <Input
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
              disabled={depositing}
              className="border border-border-soft bg-bg-elev rounded-sm text-[15px] font-mono px-2 h-9"
            />
            <Button
              variant="primary"
              size="md"
              aria-live="polite"
              aria-atomic="true"
              disabled={!canDeposit}
              onClick={() => {
                void ub.deposit(amount).then(() => {
                  setAmount("");
                });
              }}
            >
              {depositing ? "Depositing…" : "Deposit to unified balance"}
            </Button>
          </div>

          {ub.depositState.status === "error" && ub.depositState.error && (
            <div role="alert" className="text-[12px] text-red">
              {ub.depositState.error}
            </div>
          )}
          {ub.depositState.status === "success" && explorerUrl && (
            <div role="status">
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-accent hover:text-accent-2 font-mono"
              >
                Deposit confirmed ↗
              </a>
            </div>
          )}

          <div className="text-[11px] text-text-mute pt-1 border-t border-border-soft">
            To spend from the unified balance, ask your Agent — e.g. “spend 1 USDC from my unified
            balance to Ethereum”.
          </div>
        </>
      )}
    </div>
  );
}
