import type { ReactNode } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/use-theme.tsx";
import { Logo } from "./Logo.tsx";
import { LeagueBar, MarketNav, type NavDestination } from "./MarketNav.tsx";

interface Props {
  /** Rendered before the logo — the docs page's sidebar toggle. */
  leading?: ReactNode;
  /** When set, the logo group is a button (back to the home page);
   *  otherwise it renders as a plain, non-interactive group. */
  onLogoClick?: (() => void) | undefined;
  /** Accessible name for the logo button. */
  logoLabel?: string;
  /** Small divider + label after the logo (the docs page's "Docs"). */
  tag?: string;
  /** League / section nav handler. When set, the `MarketNav` renders
   *  inline at `md`+ and as its own strip below — same double-render /
   *  single-display pattern as before the extraction. */
  onNavigate?: ((destination: NavDestination) => void) | undefined;
  /** Row gap utilities, so each caller keeps its exact spacing. */
  gapClassName?: string;
  /** The "Launch App" CTA — opens the in-app shell. */
  onLaunch: () => void;
}

/**
 * B-014 — the one header shell for the standalone public pages (docs,
 * legal). Border-b + logo group + optional league nav +
 * theme toggle + Launch App CTA, previously three copy-pasted
 * implementations drifting apart. The in-app shell header
 * (`shell/Header.tsx`) stays separate: it carries auth state
 * (WalletMenu / login+signup), a larger logo, and the mobile nav sheet.
 */
export function SiteHeader({
  leading,
  onLogoClick,
  logoLabel = "Back to home",
  tag,
  onNavigate,
  gapClassName = "gap-4",
  onLaunch,
}: Props) {
  const { theme, toggle } = useTheme();
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const logoInner = (
    <>
      <Logo size={28} />
      <span className="text-[15px] font-semibold tracking-tight">Mantua</span>
    </>
  );
  return (
    <header className="border-b border-border-soft">
      <div className={`flex items-center ${gapClassName} px-5 sm:px-8 py-4`}>
        {leading}
        {onLogoClick ? (
          <button
            type="button"
            onClick={onLogoClick}
            className="flex shrink-0 items-center gap-2.5 cursor-pointer"
            aria-label={logoLabel}
          >
            {logoInner}
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-2.5">{logoInner}</div>
        )}
        {tag !== undefined && (
          <span className="hidden shrink-0 items-center gap-2 sm:inline-flex">
            <span className="h-3.5 w-px bg-border-soft" aria-hidden="true" />
            <span className="text-[13px] text-text-dim">{tag}</span>
          </span>
        )}
        {onNavigate && (
          <MarketNav onNavigate={onNavigate} className="hidden min-w-0 flex-1 md:block" />
        )}
        <div className={`ml-auto flex shrink-0 items-center gap-2${onNavigate ? " md:ml-0" : ""}`}>
          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle theme"
            className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border-soft bg-transparent text-text-dim hover:text-text transition-colors"
          >
            <ThemeIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onLaunch}
            className="px-4 py-2 rounded-md bg-accent text-white text-[13px] font-semibold hover:bg-accent-2 transition-colors cursor-pointer"
          >
            Launch App
          </button>
        </div>
      </div>
      {/* Too narrow to share the row — the nav gets its own strip. */}
      {onNavigate && <MarketNav onNavigate={onNavigate} className="px-5 pb-3 md:hidden" />}
      {onNavigate && (
        <LeagueBar
          onNavigate={onNavigate}
          className="border-t border-border-soft px-3 py-1.5 sm:px-5 md:px-8"
        />
      )}
    </header>
  );
}
