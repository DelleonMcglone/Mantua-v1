import { lazy, Suspense, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

// Task 071 (MX-006) — the bank-connection and QR libraries load with the
// first deposit, not the app.
const DepositCard = lazy(() =>
  import("./DepositCard.tsx").then((m) => ({ default: m.DepositCard })),
);
const WithdrawModal = lazy(() =>
  import("./WithdrawModal.tsx").then((m) => ({ default: m.WithdrawModal })),
);

/**
 * 029 / C-011 — the wallet card with its deposit and withdraw entry points,
 * next to the wallet they act on. "Send from my wallet" on the deposit
 * surface's agent tab hands the agent address across as the withdraw
 * recipient. Shared by the desktop profile and the phone profile (task 071).
 */
export function ProfileWalletSection({ walletAddress }: { walletAddress: string | undefined }) {
  const [modal, setModal] = useState<"deposit" | "withdraw" | null>(null);
  const [withdrawRecipient, setWithdrawRecipient] = useState<string | undefined>(undefined);
  return (
    <>
      <section className="rounded-md border border-border-soft px-4 py-3.5">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">Wallet</h3>
        {walletAddress ? (
          <p className="mt-1.5 break-all font-mono text-[13px]">{walletAddress}</p>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-text-dim">No wallet connected.</p>
        )}
        <p className="mt-1 hidden text-[11px] text-text-mute md:block">
          Balances and assets are in the portfolio panel on the left.
        </p>
        <div className="mt-2.5 flex gap-2">
          <Button
            variant="primary"
            size="sm"
            className="h-11 flex-1 md:h-8 md:flex-none"
            onClick={() => {
              setModal("deposit");
            }}
          >
            <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" /> Deposit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 flex-1 md:h-8 md:flex-none"
            disabled={!walletAddress}
            onClick={() => {
              setWithdrawRecipient(undefined);
              setModal("withdraw");
            }}
          >
            <ArrowUpFromLine className="mr-1.5 h-3.5 w-3.5" /> Withdraw
          </Button>
        </div>
      </section>

      <Suspense fallback={null}>
        {modal === "deposit" && (
          <DepositCard
            walletAddress={walletAddress}
            onClose={() => {
              setModal(null);
            }}
            onSendFromWallet={(recipient) => {
              setWithdrawRecipient(recipient);
              setModal("withdraw");
            }}
          />
        )}
        {modal === "withdraw" && (
          <WithdrawModal
            initialRecipient={withdrawRecipient}
            onClose={() => {
              setModal(null);
            }}
          />
        )}
      </Suspense>
    </>
  );
}
