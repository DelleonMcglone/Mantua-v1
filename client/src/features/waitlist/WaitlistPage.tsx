import { Header } from "@/components/shell/Header.tsx";
import { Footer } from "@/components/shell/Footer.tsx";
import type { LegalDoc } from "@/components/legal/LegalPage.tsx";
import type { NavDestination } from "@/components/shell/MarketNav.tsx";
import { HeroWordmark } from "./HeroWordmark.tsx";
import { WaitlistForm } from "./WaitlistForm.tsx";

interface Props {
  onNavigate: (destination: NavDestination) => void;
  onLogoClick: () => void;
  onOpenDocs: () => void;
  onOpenLegal: (doc: LegalDoc) => void;
}

/**
 * The pre-launch landing page at `/waitlist` (owner, 2026-10-04): the home
 * header without help / login / sign-up, the brand hero, one email field,
 * a demo-video slot, and the home footer — all over the night-sky art.
 * The art is always dark, so the page's text is fixed light regardless
 * of the theme.
 */
export function WaitlistPage({ onNavigate, onLogoClick, onOpenDocs, onOpenLegal }: Props) {
  return (
    <div
      className="theme-dark relative flex min-h-screen flex-col bg-[#07040f] text-white"
      data-testid="waitlist-page"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-cover bg-top"
        style={{ backgroundImage: "url(/assets/waitlist-bg.jpg)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-[#07040f]"
      />
      <div className="relative flex flex-1 flex-col">
        <Header
          minimal
          onLogoClick={onLogoClick}
          onNavigate={onNavigate}
          className="border-white/10 bg-black/25 backdrop-blur-sm"
        />
        <main className="flex flex-1 flex-col items-center px-5 pb-10 pt-10 sm:px-8 sm:pt-16">
          <section className="w-full max-w-4xl text-center">
            <h1 className="sr-only">Mantua — Programmable Sports Agents</h1>
            <HeroWordmark className="mx-auto w-full max-w-3xl" />
            <div
              aria-hidden
              className="mx-auto mt-2 h-px w-2/3 max-w-md bg-gradient-to-r from-transparent via-[#38a8e8] to-transparent"
            />
            <p className="mt-6 text-[22px] font-medium tracking-tight sm:text-[32px]">
              <span className="text-[#a07cff]">Programmable</span>{" "}
              <span className="text-white">Sports</span>{" "}
              <span className="text-[#2ee6a6]">Agents</span>
            </p>
          </section>

          <section className="mt-10 w-full max-w-4xl text-center" aria-labelledby="waitlist-h">
            <h2 id="waitlist-h" className="text-[13px] uppercase tracking-[0.2em] text-white/60">
              Join the waitlist
            </h2>
            <div className="mt-4">
              <WaitlistForm />
            </div>
            <p className="mt-3 text-[12px] text-white/45">
              One email when we open. No spam, no sharing.
            </p>
          </section>

          <section className="mt-14 w-full max-w-4xl" aria-labelledby="demo-h">
            <h2 id="demo-h" className="sr-only">
              See what the app can do
            </h2>
            <div
              data-testid="waitlist-video"
              className="flex aspect-video w-full items-center justify-center rounded-lg border border-white/15 bg-black/50 backdrop-blur-sm"
            >
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-white/10">
                  <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6 fill-white" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <p className="mt-4 text-[14px] font-medium text-white/85">Demo video coming soon</p>
                <p className="mt-1 text-[12.5px] text-white/50">
                  A walk through the board, the agent and a first trade.
                </p>
              </div>
            </div>
          </section>
        </main>
        <div className="border-white/10 text-white/80 [&_footer]:border-white/10">
          <Footer onOpenDocs={onOpenDocs} onOpenLegal={onOpenLegal} />
        </div>
      </div>
    </div>
  );
}
