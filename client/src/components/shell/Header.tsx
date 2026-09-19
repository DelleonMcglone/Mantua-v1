import { useState } from "react";
import { Sun, Moon, Menu, LifeBuoy } from "lucide-react";
import { useTheme } from "@/hooks/use-theme.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Logo } from "./Logo.tsx";
import { WalletMenu } from "./WalletMenu.tsx";
import { MarketNav, type NavDestination } from "./MarketNav.tsx";
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
   *  user back to the landing page from the in-app shell. */
  onLogoClick?: (() => void) | undefined;
  /** League / section nav handler. The same nav the landing header
   *  shows, so a league is one click away from anywhere in the app. */
  onNavigate: (destination: NavDestination) => void;
  /** Quick-action handler for the mobile nav sheet (the home prompt
   *  cards). Optional so the header works without it. */
  onQuickAction?: ((id: HomePromptId) => void) | undefined;
}

/**
 * Top bar — logo left, league nav centred, theme toggle + Connect Wallet
 * right. Mirrors the landing header so the nav is continuous across both
 * surfaces; below `md` the nav hides behind a hamburger that opens the
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
}: HeaderProps) {
  const { theme, toggle } = useTheme();
  const Icon = theme === "dark" ? Sun : Moon;
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className="border-b border-border-soft">
      <div className="flex items-center gap-4 lg:gap-6 px-5 py-4 md:px-8">
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
          aria-label={onLogoClick ? "Back to landing page" : "Mantua"}
          className="flex shrink-0 items-center gap-3 bg-transparent border-none p-0 cursor-pointer disabled:cursor-default"
        >
          <Logo size={30} />
          <span className="text-[17px] font-semibold tracking-tight">Mantua</span>
        </button>
        <MarketNav onNavigate={onNavigate} className="hidden min-w-0 flex-1 md:block" />
        <div className="ml-auto flex shrink-0 items-center gap-2.5 md:ml-0">
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
