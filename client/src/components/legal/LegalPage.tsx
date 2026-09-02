import type { ReactNode } from "react";
import { Sun, Moon, ArrowLeft } from "lucide-react";
import { useTheme } from "@/hooks/use-theme.tsx";
import { Logo } from "@/components/shell/Logo.tsx";

/** The legal documents reachable from the landing footer. */
export type LegalDoc = "privacy" | "terms" | "integrity";

/** Shown at the top of each policy. Bump when the text changes
 *  materially. */
export const EFFECTIVE_DATE = "August 15, 2026";

/** One channel handles privacy requests, terms questions, and market
 *  integrity reports while the support inbox is not yet set up. */
export const DISCORD_URL = "https://discord.gg/kUfEpzvaFf";

/** Governing law for the Terms. Set to Delaware on the basis that the
 *  operating entity is established there — re-check if that changes. The
 *  Terms deliberately stop short of naming a forum or committing to
 *  arbitration; that wording is for counsel to add. */
export const GOVERNING_LAW = "the State of Delaware, United States";

interface Props {
  title: string;
  /** Lead paragraph under the title. */
  intro: ReactNode;
  children: ReactNode;
  /** Back to the marketing page. */
  onBack: () => void;
  /** Opens the app shell, same as the landing header's CTA. */
  onLaunch: () => void;
}

/**
 * Shared shell for the public legal pages — privacy, terms, market
 * integrity. Each renders outside the app shell, the same way the
 * landing page does, with its own header, back affordance, and a
 * minimal footer.
 *
 * The documents these pages carry are plain-language drafts written for
 * this product. None has been reviewed by counsel — treat the copy as a
 * starting point, not a cleared legal document.
 */
export function LegalPage({ title, intro, children, onBack, onLaunch }: Props) {
  const { theme, toggle } = useTheme();
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      <header className="flex items-center gap-4 border-b border-border-soft px-5 sm:px-8 py-4">
        <button
          type="button"
          onClick={onBack}
          className="flex shrink-0 items-center gap-2.5 cursor-pointer"
          aria-label="Back to home"
        >
          <Logo size={28} />
          <span className="text-[15px] font-semibold tracking-tight">Mantua</span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2">
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
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-5 sm:px-8 py-12">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>

        <h1 className="mt-6 text-3xl sm:text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 text-[13px] text-text-mute">Effective {EFFECTIVE_DATE}</p>

        <div className="mt-8 text-[14px] leading-relaxed text-text-dim">{intro}</div>

        {children}
      </main>

      <footer className="border-t border-border-soft px-5 sm:px-8 py-8">
        <p className="text-[11px] text-text-mute text-center">
          © 2026 Mantua Intelligence. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

/** A titled block of policy text. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-text-dim">{children}</div>
    </section>
  );
}

/** Bulleted list styled to match the policy body. */
export function List({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc list-outside pl-5 marker:text-text-mute space-y-2">{children}</ul>
  );
}

/** Inline Discord link styled as a policy link. */
export function DiscordLink() {
  return (
    <a href={DISCORD_URL} className="text-accent hover:text-accent-2 underline">
      Discord
    </a>
  );
}
