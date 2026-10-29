import { Header } from "@/components/shell/Header.tsx";
import { Footer } from "@/components/shell/Footer.tsx";
import type { LegalDoc } from "@/components/legal/LegalPage.tsx";
import type { NavDestination } from "@/components/shell/MarketNav.tsx";

interface Props {
  onNavigate: (destination: NavDestination) => void;
  onLogoClick: () => void;
  onOpenDocs: () => void;
  onOpenLegal: (doc: LegalDoc) => void;
  /** Both open the login modal; signing in takes the visitor into the app. */
  onLogin: () => void;
  onSignup: () => void;
}

/**
 * The landing page (owner, 2026-10-04; login from here since 2026-10-21):
 * the home header with Log in / Sign up (no help, no theme toggle), the
 * brand hero, the demo video, and the home footer — all over the
 * night-sky art. The art is always dark, so the page's text is fixed
 * light regardless of the theme.
 */
export function WaitlistPage({
  onNavigate,
  onLogoClick,
  onOpenDocs,
  onOpenLegal,
  onLogin,
  onSignup,
}: Props) {
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
          onLogin={onLogin}
          onSignup={onSignup}
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

          <section className="mt-14 w-full max-w-4xl" aria-labelledby="demo-h">
            <h2 id="demo-h" className="sr-only">
              See what the app can do
            </h2>
            {/* The demo, hosted on YouTube (owner, 2026-10-05); the
                privacy-enhanced host sets no cookies until play. */}
            <iframe
              data-testid="waitlist-video"
              className="aspect-video w-full rounded-lg border border-white/15 bg-black"
              src="https://www.youtube-nocookie.com/embed/siArImNtatM?rel=0&modestbranding=1"
              title="Mantua demo"
              loading="lazy"
              allow="accelerometer; encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </section>
        </main>
        <div className="border-white/10 text-white/80 [&_footer]:border-white/10">
          <Footer onOpenDocs={onOpenDocs} onOpenLegal={onOpenLegal} />
        </div>
      </div>
    </div>
  );
}
