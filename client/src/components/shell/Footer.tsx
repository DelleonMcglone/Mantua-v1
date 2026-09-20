import type { ComponentType } from "react";
import type { LegalDoc } from "@/components/legal/LegalPage.tsx";
import { XIcon, RedditIcon, LinkedInIcon, SubstackIcon, DiscordIcon } from "./social-icons.tsx";

/**
 * Task 075 (Phase 19, HP-003) — the home page's footer. Everything here
 * survives from the deleted `LandingPage`'s own footer verbatim (see the
 * content inventory in `docs/tasks/075-home-page-restructure.md`): the
 * Documentation link, the social channels, the copyright line, and the
 * three legal links the Terms acceptance gate depends on (HP-005) — all
 * reachable from `/` without logging in, since this now IS `/`.
 */

interface Props {
  /** Opens the documentation site (the `docs` route). */
  onOpenDocs: () => void;
  /** Opens one of the standalone legal pages (the `legal` route). */
  onOpenLegal: (doc: LegalDoc) => void;
}

/** Social channels in the footer. `href: "#"` marks a channel that
 *  doesn't have a public URL yet — fill these in as they go live. */
const SOCIAL_LINKS: {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { label: "X", href: "https://x.com/Mantua_AI", icon: XIcon },
  { label: "Discord", href: "https://discord.gg/kUfEpzvaFf", icon: DiscordIcon },
  { label: "Substack", href: "https://substack.com/@mantuanews", icon: SubstackIcon },
  { label: "Reddit", href: "https://www.reddit.com/r/MantuaAI/", icon: RedditIcon },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/mantuaai/?viewAsMember=true",
    icon: LinkedInIcon,
  },
];

/** Policy links sharing the copyright line — each opens its own page. */
const LEGAL_LINKS: { label: string; doc: LegalDoc }[] = [
  { label: "Privacy", doc: "privacy" },
  { label: "Terms of Use", doc: "terms" },
  { label: "Market Integrity", doc: "integrity" },
];

export function Footer({ onOpenDocs, onOpenLegal }: Props) {
  return (
    <footer className="mt-10 border-t border-border-soft px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <button
          type="button"
          onClick={onOpenDocs}
          className="text-[13px] font-semibold text-text transition-colors hover:text-accent cursor-pointer"
        >
          Documentation
        </button>

        <p className="mt-8 text-[11px] uppercase tracking-[0.2em] text-text-mute">Social Media</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-[13px]">
          {SOCIAL_LINKS.map((l, i) => {
            const Icon = l.icon;
            return (
              <span key={l.label} className="flex items-center gap-x-2">
                {i > 0 && <span className="text-text-mute">-</span>}
                <a
                  href={l.href}
                  target={l.href === "#" ? undefined : "_blank"}
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-text-dim transition-colors hover:text-accent"
                >
                  <Icon className="h-[15px] w-[15px]" />
                  {l.label}
                </a>
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-text-mute">
        <span>© 2026 Mantua Intelligence. All rights reserved.</span>
        {LEGAL_LINKS.map((l) => (
          <span key={l.label} className="flex items-center gap-x-2">
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => {
                onOpenLegal(l.doc);
              }}
              className="cursor-pointer transition-colors hover:text-accent"
            >
              {l.label}
            </button>
          </span>
        ))}
      </div>
    </footer>
  );
}
