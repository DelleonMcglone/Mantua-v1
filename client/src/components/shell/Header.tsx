import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/use-theme.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Logo } from "./Logo.tsx";
import { WalletMenu } from "./WalletMenu.tsx";
import { MarketNav, type NavDestination } from "./MarketNav.tsx";
import { ChainSelector } from "./ChainSelector.tsx";

interface HeaderProps {
  walletAddress?: string | undefined;
  /** Logged-out entry points (B6-002). Both open the Privy modal — the
   *  labels advertise the two paths, the modal handles either flow. */
  onLogin?: (() => void) | undefined;
  onSignup?: (() => void) | undefined;
  onDisconnect?: (() => void) | undefined;
  /** Profile button target — the profile/portfolio page (B6-008). */
  onOpenProfile?: (() => void) | undefined;
  /** Agent panel target, for the spending-cap menu item (B6-012). */
  onOpenAgent?: (() => void) | undefined;
  /** Click handler for the logo / wordmark group. Used to send the
   *  user back to the landing page from the in-app shell. */
  onLogoClick?: (() => void) | undefined;
  /** League / section nav handler. The same nav the landing header
   *  shows, so a league is one click away from anywhere in the app. */
  onNavigate: (destination: NavDestination) => void;
}

/**
 * Top bar — logo left, league nav centred, theme toggle + Connect Wallet
 * right. Mirrors the landing header so the nav is continuous across both
 * surfaces; below `md` the nav drops to its own strip, where there isn't
 * room to share the row.
 */
export function Header({
  walletAddress,
  onLogin,
  onSignup,
  onDisconnect,
  onOpenProfile,
  onOpenAgent,
  onLogoClick,
  onNavigate,
}: HeaderProps) {
  const { theme, toggle } = useTheme();
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <header className="border-b border-border-soft">
      <div className="flex items-center gap-4 lg:gap-6 px-8 py-4">
        <button
          type="button"
          onClick={onLogoClick}
          disabled={!onLogoClick}
          aria-label={onLogoClick ? "Back to landing page" : "Mantua"}
          className="flex shrink-0 items-center gap-3 bg-transparent border-none p-0 cursor-pointer disabled:cursor-default"
        >
          <Logo size={30} />
          <span className="text-[17px] font-semibold tracking-tight">Mantua</span>
        </button>
        <MarketNav onNavigate={onNavigate} className="hidden min-w-0 flex-1 md:block" />
        <div className="ml-auto flex shrink-0 items-center gap-2.5 md:ml-0">
          <ChainSelector direction="down" />
          <Button variant="icon" size="icon" aria-label="Toggle theme" onClick={toggle}>
            <Icon className="h-[18px] w-[18px]" />
          </Button>
          {walletAddress && onDisconnect ? (
            <WalletMenu
              walletAddress={walletAddress}
              onDisconnect={onDisconnect}
              onOpenProfile={onOpenProfile}
              onOpenAgent={onOpenAgent}
            />
          ) : (
            <>
              <Button variant="ghost" onClick={onLogin}>
                Log in
              </Button>
              <Button variant="primary" onClick={onSignup}>
                Sign up
              </Button>
            </>
          )}
        </div>
      </div>
      {/* Too narrow to share the row — the nav gets its own strip. */}
      <MarketNav onNavigate={onNavigate} className="px-5 pb-3 md:hidden" />
    </header>
  );
}
