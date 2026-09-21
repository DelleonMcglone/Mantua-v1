import { Suspense, type ReactNode } from "react";
import { StatusBanner } from "@/features/status/PlatformStatusProvider.tsx";
import { Header } from "./Header.tsx";
import { PanelLoading } from "./PanelLoading.tsx";
import type { NavDestination } from "./MarketNav.tsx";
import type { HomePromptId } from "./HomeMenu.tsx";
import type { SportId } from "@/features/markets/sports.ts";

interface AppShellProps {
  walletAddress?: string | undefined;
  onLogin?: (() => void) | undefined;
  onSignup?: (() => void) | undefined;
  onDisconnect?: (() => void) | undefined;
  onOpenProfile?: (() => void) | undefined;
  onOpenAgent?: (() => void) | undefined;
  /** Optional click handler for the logo / wordmark — used to send
   *  the user back to the home page from anywhere in the app shell. */
  onLogoClick?: (() => void) | undefined;
  /** League / section nav handler, forwarded to the header. */
  onNavigate: (destination: NavDestination) => void;
  /** Quick-action handler for the mobile nav sheet, forwarded to the
   *  header (B-014). */
  onQuickAction?: ((id: HomePromptId) => void) | undefined;
  /** The league page currently open (highlighted in the league bar). */
  activeSport?: SportId | null | undefined;
  left: ReactNode;
  right: ReactNode;
  /** When set, replaces the two-column grid with a full-width page
   *  (league pages, trading, agent — the Polymarket-style surfaces). */
  full?: ReactNode | undefined;
  /** Persistent chat dock, rendered at the bottom of every page. */
  dock?: ReactNode | undefined;
  /** Page footer (the home page only). Rendered BELOW the dock: the page
   *  scrolls as a whole, the dock sticks to the bottom of the viewport
   *  while the content is in view, and the footer follows once the user
   *  scrolls past the end of the page. */
  footer?: ReactNode | undefined;
}

/**
 * PD-004 — app shell layout. Matches the prototype 2-column grid (340/460
 * minimums, 1/1.3 ratio) with density-scaled padding and gap. Below 1024px
 * the grid collapses to a single column; the right column stacks below
 * (deviation from prototype, documented in PD-007).
 */
export function AppShell({
  walletAddress,
  onLogin,
  onSignup,
  onDisconnect,
  onOpenProfile,
  onOpenAgent,
  onLogoClick,
  onNavigate,
  onQuickAction,
  activeSport,
  left,
  right,
  full,
  dock,
  footer,
}: AppShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <Header
        walletAddress={walletAddress}
        onLogin={onLogin}
        onSignup={onSignup}
        onDisconnect={onDisconnect}
        onOpenProfile={onOpenProfile}
        onOpenAgent={onOpenAgent}
        onLogoClick={onLogoClick}
        onNavigate={onNavigate}
        onQuickAction={onQuickAction}
        activeSport={activeSport}
      />
      {/* Phase 7 / R-005 — the platform status banner: rendered only while
          degraded, paused, unreachable or offline. */}
      <StatusBanner className="px-4 pt-3 md:px-8" />
      {full ? (
        // With a footer the document scrolls (so the footer can sit under
        // the sticky dock); otherwise the page owns its scroll region.
        <main className={footer ? "flex-1" : "flex-1 min-h-0 overflow-auto"}>
          <Suspense fallback={<PanelLoading />}>{full}</Suspense>
        </main>
      ) : (
        <main
          className="grid flex-1 min-h-0 items-stretch"
          style={{
            gridTemplateColumns: "1fr",
            padding: "calc(20px * var(--density)) calc(32px * var(--density))",
            gap: "calc(20px * var(--density))",
          }}
        >
          <div
            className="grid min-h-0"
            style={{
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: "calc(20px * var(--density))",
            }}
          >
            {/* Two-column at ≥1024px; stacks below. Done in style attr because
                Tailwind 4 minmax + var() in arbitrary values is fiddly. */}
            <div
              className="grid min-h-0"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
                gap: "calc(20px * var(--density))",
              }}
            >
              <div className="flex flex-col min-h-0" style={{ gap: "calc(20px * var(--density))" }}>
                <Suspense fallback={<PanelLoading />}>{left}</Suspense>
              </div>
              <div className="flex flex-col min-h-0">
                <Suspense fallback={<PanelLoading />}>{right}</Suspense>
              </div>
            </div>
          </div>
        </main>
      )}
      {dock && (
        <div className={footer ? "sticky bottom-0 z-20 shrink-0 bg-bg" : "shrink-0 bg-bg"}>
          {dock}
        </div>
      )}
      {footer}
    </div>
  );
}
