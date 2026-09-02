import type { ReactNode } from "react";
import { Header } from "./Header.tsx";
import type { NavDestination } from "./MarketNav.tsx";

interface AppShellProps {
  walletAddress?: string | undefined;
  onLogin?: (() => void) | undefined;
  onSignup?: (() => void) | undefined;
  onDisconnect?: (() => void) | undefined;
  onOpenProfile?: (() => void) | undefined;
  onOpenAgent?: (() => void) | undefined;
  /** Optional click handler for the logo / wordmark — used to send
   *  the user back to the landing page from inside the app shell. */
  onLogoClick?: (() => void) | undefined;
  /** League / section nav handler, forwarded to the header. */
  onNavigate: (destination: NavDestination) => void;
  left: ReactNode;
  right: ReactNode;
  /** When set, replaces the two-column grid with a full-width page
   *  (league pages, trading, agent — the Polymarket-style surfaces). */
  full?: ReactNode | undefined;
  /** Persistent chat dock, rendered at the bottom of every page. */
  dock?: ReactNode | undefined;
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
  left,
  right,
  full,
  dock,
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
      />
      {full ? (
        <main className="flex-1 min-h-0 overflow-auto">{full}</main>
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
                {left}
              </div>
              <div className="flex flex-col min-h-0">{right}</div>
            </div>
          </div>
        </main>
      )}
      {dock && <div className="shrink-0 bg-bg">{dock}</div>}
    </div>
  );
}
