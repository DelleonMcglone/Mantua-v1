import { useState } from "react";
import { Sun, Moon, Menu, LifeBuoy } from "lucide-react";
import { useTheme } from "@/hooks/use-theme.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Logo } from "./Logo.tsx";
import { WalletMenu } from "./WalletMenu.tsx";
import { LeagueBar, MarketNav, type NavDestination } from "./MarketNav.tsx";
import type { SportId } from "@/features/markets/sports.ts";
import { MobileNavSheet } from "./MobileNavSheet.tsx";
import type { HomePromptId } from "./HomeMenu.tsx";

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
   *  user back to the home page from anywhere in the in-app shell. */
  onLogoClick?: (() => void) | undefined;
  /** League / section nav handler. The same nav the docs/legal pages'
   *  header shows, so a league is one click away from anywhere in the app. */
  onNavigate: (destination: NavDestination) => void;
  /** Quick-action handler for the mobile nav sheet (the home prompt
   *  cards). Optional so the header works without it. */
  onQuickAction?: ((id: HomePromptId) => void) | undefined;
  /** The league page currently open, highlighted in the league bar. */
  activeSport?: SportId | null | undefined;
}

/**
 * Top bar — logo left, league nav centred, theme toggle + Connect Wallet
 * right. Mirrors `SiteHeader` (docs/legal) so the nav is continuous across
 * both surfaces; below `md` the nav hides behind a hamburger that opens the
 * `MobileNavSheet` (B-014 mobile guidance: hidden sidebar + hamburger).
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
  onQuickAction,
  activeSport = null,
}: HeaderProps) {
  const { theme, toggle } = useTheme();
  const Icon = theme === "dark" ? Sun : Moon;
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className="border-b border-border-soft">
      {/* Task 071: fits a 360 px phone logged out — tighter gaps, the wordmark
          from `sm`, the auth buttons compact below `md`. */}
      <div className="flex items-center gap-2 px-3 py-3 md:gap-4 md:px-8 md:py-4 lg:gap-6">
        <Button
          variant="icon"
          size="icon"
          aria-label="Menu"
          className="md:hidden"
          onClick={() => {
            setNavOpen(true);
          }}
        >
          <Menu className="h-[18px] w-[18px]" />
        </Button>
        <button
          type="button"
          onClick={onLogoClick}
          disabled={!onLogoClick}
          aria-label={onLogoClick ? "Back to home" : "Mantua"}
          className="flex shrink-0 items-center gap-3 bg-transparent border-none p-0 cursor-pointer disabled:cursor-default"
        >
          <Logo size={30} />
          <span className="hidden text-[17px] font-semibold tracking-tight sm:inline">Mantua</span>
        </button>
        <MarketNav onNavigate={onNavigate} className="hidden min-w-0 flex-1 md:block" />
        <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-0 md:gap-2.5">
          {/* Task 070 (AE-007) — help is one press from anywhere, signed in
              or not; the app listens for the event like it does for login. */}
          <Button
            variant="icon"
            size="icon"
            aria-label="Help & support"
            onClick={() => {
              window.dispatchEvent(new Event("mantua:open-support"));
            }}
          >
            <LifeBuoy className="h-[18px] w-[18px]" />
          </Button>
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
              <Button variant="ghost" className="px-2.5 md:px-4" onClick={onLogin}>
                Log in
              </Button>
              <Button variant="primary" className="px-3 md:px-4" onClick={onSignup}>
                Sign up
              </Button>
            </>
          )}
        </div>
      </div>
      {/* The league sub-header: every league with its logo, NFL live, the
          rest coming soon. Below `md` the leagues live in the hamburger
          sheet and the league page's chips instead (B-014). */}
      <LeagueBar
        onNavigate={onNavigate}
        active={activeSport}
        className="hidden border-t border-border-soft px-3 py-1.5 md:block md:px-8"
      />
      {/* Below `md` the nav lives behind the hamburger, per the mobile
          design guidance — no more double-rendered strip. */}
      <MobileNavSheet
        open={navOpen}
        onOpenChange={setNavOpen}
        onNavigate={onNavigate}
        onQuickAction={onQuickAction}
      />
    </header>
  );
}
