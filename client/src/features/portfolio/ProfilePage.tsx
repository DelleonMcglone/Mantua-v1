import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Bot, Droplet, LogOut, Megaphone } from "lucide-react";
import { StrategiesSection } from "./StrategiesSection.tsx";
import { MarketPositionsSection } from "./MarketPositionsSection.tsx";
import { LpEconomicsSection, SettledPositionsSection } from "./EconomicsSections.tsx";
import { usePortfolioEconomics } from "./use-portfolio-economics.ts";
import { DepositCard } from "./DepositCard.tsx";
import { WithdrawModal } from "./WithdrawModal.tsx";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";

interface Props {
  walletAddress?: string | undefined;
  onViewPositions: () => void;
  onOpenAgent: () => void;
  /** Task 070 — the agent's public page and posting settings. */
  onOpenSocial: () => void;
  onLogout: () => void;
  onClose?: () => void;
}

/**
 * B6-008 — the profile page the header's profile button lands on. The
 * portfolio lives here rather than as standalone nav: while this route is
 * open, the left column shows the full portfolio (balances + assets), and
 * this panel holds the account itself — wallet, market positions, LP
 * positions, and the agent wallet.
 *
 * Market positions (B6-009) render an honest empty state until the Dynamic
 * Market Hook deploys — there is nothing to show before markets exist, and
 * pretending otherwise would be worse than saying so.
 */
export function ProfilePage({
  walletAddress,
  onViewPositions,
  onOpenAgent,
  onOpenSocial,
  onLogout,
  onClose,
}: Props) {
  // 029 / C-011 — deposit + withdraw entry points live here, next to the
  // wallet they act on. "Send from my wallet" on the deposit surface's
  // agent tab hands the agent address across as the withdraw recipient.
  const [modal, setModal] = useState<"deposit" | "withdraw" | null>(null);
  // Phase 9 / PF-009, PF-012 — the per-pool LP view and settled history.
  const economics = usePortfolioEconomics(walletAddress ?? null);
  const [withdrawRecipient, setWithdrawRecipient] = useState<string | undefined>(undefined);

  return (
    <>
      <PanelHeader />
      <PanelSubHeader
        title="Profile"
        subtitle="Your wallet, positions, and agent"
        {...(onClose ? { onClose } : {})}
      />
      <div className="flex-1 overflow-auto px-5 pb-6">
        <section className="rounded-md border border-border-soft px-4 py-3.5">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">
            Wallet
          </h3>
          {walletAddress ? (
            <p className="mt-1.5 break-all font-mono text-[13px]">{walletAddress}</p>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-text-dim">No wallet connected.</p>
          )}
          <p className="mt-1 text-[11px] text-text-mute">
            Balances and assets are in the portfolio panel on the left.
          </p>
          <div className="mt-2.5 flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setModal("deposit");
              }}
            >
              <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" /> Deposit
            </Button>
            <Button
              variant="ghost"
              size="sm"
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

        <MarketPositionsSection />
        <SettledPositionsSection econ={economics} />
        <LpEconomicsSection econ={economics} />

        <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
            <Droplet className="h-3.5 w-3.5" /> Liquidity positions
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
            Your LP positions across pools and hooks, with position history.
          </p>
          <Button variant="ghost" size="sm" className="mt-2.5" onClick={onViewPositions}>
            View LP positions
          </Button>
        </section>

        <StrategiesSection />

        <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
            <Bot className="h-3.5 w-3.5" /> Agent wallet
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
            Your agent&apos;s wallet, funding, and spending cap live in the Agent panel.
          </p>
          <Button variant="ghost" size="sm" className="mt-2.5" onClick={onOpenAgent}>
            Open agent
          </Button>
        </section>

        <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
            <Megaphone className="h-3.5 w-3.5" /> Agent voice &amp; public page
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
            Claim a public handle for your agent&apos;s track record — derived from its
            chain-verified trades, never edited — and choose what it may post.
          </p>
          <Button variant="ghost" size="sm" className="mt-2.5" onClick={onOpenSocial}>
            Manage voice &amp; page
          </Button>
        </section>

        <Button variant="ghost" size="sm" className="mt-4 w-full" onClick={onLogout}>
          <LogOut className="mr-1.5 h-3.5 w-3.5" /> Log out
        </Button>
      </div>
    </>
  );
}
