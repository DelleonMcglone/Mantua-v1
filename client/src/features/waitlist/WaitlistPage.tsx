import { Header } from "@/components/shell/Header.tsx";
import { Footer } from "@/components/shell/Footer.tsx";
import type { LegalDoc } from "@/components/legal/LegalPage.tsx";
import type { NavDestination } from "@/components/shell/MarketNav.tsx";
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
            {/* The owner's wordmark art, lifted off its background so it
                sits straight on the night sky — exact letterforms. */}
            <img
              src="/assets/waitlist-hero.png"
              alt=""
              width={1240}
              height={460}
              className="mx-auto w-full max-w-3xl"
              fetchPriority="high"
            />
            <p className="mx-auto mt-8 max-w-2xl text-[20px] font-medium leading-snug text-white sm:text-[24px]">
              Trade sports prediction markets with AI agents.
            </p>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/75 sm:text-[16px]">
              Research markets, size positions, and execute trades automatically. You set the
              strategy. Your agent executes it.
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
            <video
              data-testid="waitlist-video"
              className="aspect-video w-full rounded-lg border border-white/15 bg-black"
              src="/assets/demo.mp4"
              poster="/assets/demo-poster.jpg"
              controls
              playsInline
              preload="metadata"
            >
              Your browser can't play this video.
            </video>
          </section>
        </main>
        <div className="border-white/10 text-white/80 [&_footer]:border-white/10">
          <Footer onOpenDocs={onOpenDocs} onOpenLegal={onOpenLegal} />
        </div>
      </div>
    </div>
  );
}
