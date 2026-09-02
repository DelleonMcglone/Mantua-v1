import { Bot, Droplet, LogOut } from "lucide-react";
import { StrategiesSection } from "./StrategiesSection.tsx";
import { MarketPositionsSection } from "./MarketPositionsSection.tsx";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";

interface Props {
  walletAddress?: string | undefined;
  onViewPositions: () => void;
  onOpenAgent: () => void;
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
  onLogout,
  onClose,
}: Props) {
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
        </section>

        <MarketPositionsSection />

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

        <Button variant="ghost" size="sm" className="mt-4 w-full" onClick={onLogout}>
          <LogOut className="mr-1.5 h-3.5 w-3.5" /> Log out
        </Button>
      </div>
    </>
  );
}
