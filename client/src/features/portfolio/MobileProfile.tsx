import { ArrowLeft, Bot, Droplet, LogOut, Megaphone } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Button } from "@/components/ui/button.tsx";
import { NotificationSettings } from "@/features/notifications/NotificationSettings.tsx";
import { useAgentPortfolio } from "@/features/agent/use-agent-portfolio.ts";
import type { TokenSymbol } from "@/lib/tokens.ts";
import { AgentStatusStrip } from "./AgentStatusStrip.tsx";
import { AssetsCard } from "./AssetsCard.tsx";
import { LpEconomicsSection, SettledPositionsSection } from "./EconomicsSections.tsx";
import { MarketPositionsSection } from "./MarketPositionsSection.tsx";
import { ComboPositionsSection } from "@/features/combos/ComboPositionsSection.tsx";
import { InstitutionSection } from "@/features/institution/InstitutionSection.tsx";
import { PortfolioCard } from "./PortfolioCard.tsx";
import { ProfileWalletSection } from "./ProfileWalletSection.tsx";
import { StrategiesSection } from "./StrategiesSection.tsx";
import { usePortfolioEconomics } from "./use-portfolio-economics.ts";

interface Props {
  walletAddress?: string | undefined;
  onViewPositions: () => void;
  onOpenAgent: () => void;
  /** Task 070 — the agent's public page and posting policy. */
  onOpenSocial: () => void;
  onSelectAsset: (symbol: TokenSymbol) => void;
  onSelectPool: (id: string) => void;
  onLogout: () => void;
  onClose: () => void;
}

const TABS = [
  { id: "positions", label: "Positions" },
  { id: "portfolio", label: "Portfolio" },
  { id: "agent", label: "Agent" },
  { id: "account", label: "Account" },
] as const;

/**
 * Task 071 (MX-008) — the profile on a phone: the same sections the desktop
 * page shows, as four tabs so nothing important is a screen of scrolling
 * away. Positions first, because that is what a user opens this for
 * mid-game; the agent and the account each one tap across.
 */
export function MobileProfile({
  walletAddress,
  onViewPositions,
  onOpenAgent,
  onOpenSocial,
  onSelectAsset,
  onSelectPool,
  onLogout,
  onClose,
}: Props) {
  const economics = usePortfolioEconomics(walletAddress ?? null);
  const agent = useAgentPortfolio();
  return (
    <div data-testid="mobile-profile" className="mx-auto w-full max-w-3xl px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to home"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border-soft bg-transparent text-text-dim cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[20px] font-bold tracking-tight">Profile</h1>
      </div>
      <Tabs defaultValue="positions">
        <TabsList className="sticky top-0 z-10 grid grid-cols-4 gap-1 rounded-full border border-border-soft bg-bg-elev p-1">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              data-testid={`profile-tab-${t.id}`}
              className="min-h-11 rounded-full text-[13px] font-medium text-text-dim data-[state=active]:bg-chip data-[state=active]:text-text"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="positions">
          <MarketPositionsSection />
          <ComboPositionsSection
            onOpenBuilder={() => {
              window.dispatchEvent(new Event("mantua:open-combos"));
            }}
          />
          <SettledPositionsSection econ={economics} />
          <StrategiesSection />
        </TabsContent>
        <TabsContent value="portfolio" className="mt-3 flex flex-col gap-3">
          <PortfolioCard />
          <AssetsCard onSelectPool={onSelectPool} onSelectAsset={onSelectAsset} />
          <LpEconomicsSection econ={economics} />
          <Button variant="ghost" size="sm" className="h-11 w-full" onClick={onViewPositions}>
            <Droplet className="mr-1.5 h-3.5 w-3.5" /> View LP positions
          </Button>
        </TabsContent>
        <TabsContent value="agent" className="mt-3 rounded-md border border-border-soft">
          <AgentStatusStrip />
          <div className="px-4 pb-4">
            {agent.agentAddress && (
              <MarketPositionsSection address={agent.agentAddress} title="Agent positions" />
            )}
            <Button variant="primary" size="sm" className="mt-3 h-11 w-full" onClick={onOpenAgent}>
              <Bot className="mr-1.5 h-3.5 w-3.5" /> Open agent
            </Button>
            <Button variant="ghost" size="sm" className="mt-2 h-11 w-full" onClick={onOpenSocial}>
              <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Manage voice &amp; public page
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="account" className="mt-3">
          <ProfileWalletSection walletAddress={walletAddress} />
          <InstitutionSection />
          <NotificationSettings />
          <Button variant="ghost" size="sm" className="mt-4 h-11 w-full" onClick={onLogout}>
            <LogOut className="mr-1.5 h-3.5 w-3.5" /> Log out
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
