import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { parseAbi } from "viem";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useConfirmedAction } from "@/hooks/use-confirmed-action.tsx";
import { publicClientFor, useChainWalletClient } from "@/lib/privy/wallet-client.ts";
import { BASE_CHAIN_ID, getExplorerTxUrl } from "@/lib/chains.ts";
import { getTokens, type TokenSymbol } from "@/lib/tokens.ts";
import { usePortfolio } from "./use-portfolio.ts";
import { formatRawAmount, isValidEvmAddress, parseAmountRaw } from "./withdraw-helpers.ts";

const ERC20_TRANSFER = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

/** The withdrawable set — USDC first (the platform currency), then the rest. */
const WITHDRAW_SYMBOLS: TokenSymbol[] = ["USDC", "EURC", "cbBTC"];

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "confirming" }
  | { kind: "done"; txHash: `0x${string}` }
  | { kind: "error"; message: string };

interface Props {
  onClose: () => void;
  /** Pre-filled recipient (e.g. the agent wallet via "Send from my wallet"). */
  initialRecipient?: string | undefined;
}

/**
 * 029 / C-011 GAP-4 — the user-wallet withdrawal that never existed: a
 * client-signed ERC-20 `transfer` from the user's own wallet to any
 * address. The server holds no keys and is not involved; the flow is
 * quote-free (a transfer has no price), so it goes straight from the
 * P1-005 `confirm()` seam to sign → receipt. Copy is chainless per the
 * C-011 mental model — "Withdraw USDC", never a network name.
 */
export function WithdrawModal({ onClose, initialRecipient }: Props) {
  const chainId = BASE_CHAIN_ID;
  const { balances } = usePortfolio();
  const confirm = useConfirmedAction();
  const getWallet = useChainWalletClient();

  const [symbol, setSymbol] = useState<TokenSymbol>("USDC");
  const [recipient, setRecipient] = useState(initialRecipient ?? "");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const tokenMeta = getTokens(chainId)[symbol];
  const balance = balances.find((b) => b.symbol === symbol);
  const decimals = balance?.decimals ?? tokenMeta.decimals;
  const balanceRaw = BigInt(balance?.balanceRaw ?? "0");

  const recipientValid = isValidEvmAddress(recipient);
  const amountRaw = parseAmountRaw(amount, decimals);
  const exceedsBalance = amountRaw !== null && amountRaw > balanceRaw;
  const busy = phase.kind === "signing" || phase.kind === "confirming";
  const ready = recipientValid && amountRaw !== null && !exceedsBalance && !busy;

  async function onSubmit() {
    if (!recipientValid || amountRaw === null || exceedsBalance) return;
    const human = formatRawAmount(amountRaw, decimals);
    // P1-005 — every user-signed write passes through the confirm seam.
    const ok = await confirm({
      title: "Review withdrawal",
      description: (
        <>
          Send {human} {symbol} to{" "}
          <span className="break-all font-mono text-[12px]">{recipient}</span>. Transfers can&apos;t
          be reversed — double-check the address.
        </>
      ),
      severity: "warning",
      confirmLabel: `Withdraw ${symbol}`,
    });
    if (!ok) return;

    try {
      setPhase({ kind: "signing" });
      const wallet = await getWallet();
      if (!wallet) throw new Error("No wallet connected");
      const txHash = await wallet.writeContract({
        address: tokenMeta.address,
        abi: ERC20_TRANSFER,
        functionName: "transfer",
        args: [recipient, amountRaw],
      });
      setPhase({ kind: "confirming" });
      const receipt = await publicClientFor(chainId).waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      setPhase({ kind: "done", txHash });
      window.dispatchEvent(new Event("mantua:refresh-portfolio"));
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Withdrawal failed",
      });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw</DialogTitle>
          <DialogDescription>
            Send funds from your wallet to any address — an exchange deposit address or another
            wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-xs text-text-dim mb-2 uppercase tracking-wider">Token</p>
            <div className="grid grid-cols-3 gap-2">
              {WITHDRAW_SYMBOLS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={symbol === s}
                  onClick={() => {
                    setSymbol(s);
                    setAmount("");
                  }}
                  className={`py-2 rounded-sm border text-sm font-medium transition-colors ${
                    symbol === s
                      ? "border-accent bg-chip text-text"
                      : "border-border-soft bg-bg-elev text-text-dim hover:text-text"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="withdraw-recipient"
              className="block text-xs text-text-dim mb-2 uppercase tracking-wider"
            >
              Recipient address
            </label>
            <Input
              id="withdraw-recipient"
              value={recipient}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-[13px]"
              onChange={(e) => {
                setRecipient(e.target.value.trim());
              }}
            />
            {recipient !== "" && !recipientValid && (
              <p role="alert" className="mt-1.5 text-xs text-amber">
                Not a valid address — expected 0x followed by 40 hex characters.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label
                htmlFor="withdraw-amount"
                className="text-xs text-text-dim uppercase tracking-wider"
              >
                Amount
              </label>
              <span className="text-xs text-text-mute">
                Available: {formatRawAmount(balanceRaw, decimals)} {symbol}
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                id="withdraw-amount"
                value={amount}
                placeholder="0.00"
                inputMode="decimal"
                autoComplete="off"
                onChange={(e) => {
                  setAmount(e.target.value);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-auto shrink-0"
                disabled={balanceRaw <= 0n}
                onClick={() => {
                  setAmount(formatRawAmount(balanceRaw, decimals));
                }}
              >
                Max
              </Button>
            </div>
            {amount !== "" && amountRaw === null && (
              <p role="alert" className="mt-1.5 text-xs text-amber">
                Enter a positive amount with at most {decimals} decimal places.
              </p>
            )}
            {exceedsBalance && (
              <p role="alert" className="mt-1.5 text-xs text-amber">
                That&apos;s more than your available {symbol} balance.
              </p>
            )}
          </div>

          {phase.kind === "done" && (
            <p role="status" className="text-xs text-green">
              Withdrawal confirmed.{" "}
              <a
                href={getExplorerTxUrl(chainId, phase.txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-accent-2 inline-flex items-center gap-1"
              >
                View transaction <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          )}
          {phase.kind === "error" && (
            <p role="alert" className="text-xs text-red">
              {phase.message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {phase.kind === "done" ? "Done" : "Cancel"}
          </Button>
          <Button
            variant="primary"
            aria-live="polite"
            aria-atomic="true"
            disabled={!ready || phase.kind === "done"}
            onClick={() => {
              void onSubmit();
            }}
          >
            {phase.kind === "signing"
              ? "Sign in wallet…"
              : phase.kind === "confirming"
                ? "Confirming…"
                : phase.kind === "done"
                  ? "Sent"
                  : `Withdraw ${symbol}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
