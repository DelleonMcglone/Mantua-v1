import { useState, type ComponentType, type ReactNode } from "react";
import {
  Sun,
  Moon,
  ChevronDown,
  ShieldCheck,
  Bot,
  Wallet,
  BarChart3,
  CandlestickChart,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme.tsx";
import { Logo } from "@/components/shell/Logo.tsx";
import { MarketNav, type NavDestination } from "@/components/shell/MarketNav.tsx";
import type { LegalDoc } from "@/components/legal/LegalPage.tsx";
import {
  XIcon,
  RedditIcon,
  LinkedInIcon,
  SubstackIcon,
  DiscordIcon,
} from "@/components/landing/social-icons.tsx";

interface Props {
  /** Called when the user clicks any "Launch App" CTA. Hands off
   *  to the in-app shell (App.tsx swaps to `kind: "home"`). */
  onLaunch: () => void;
  /** Called when a header nav item is clicked — opens the app on that
   *  league's market page, the agent, or the trading panel. */
  onNavigate: (destination: NavDestination) => void;
  /** Opens one of the standalone legal pages. */
  onOpenLegal: (doc: LegalDoc) => void;
  /** Opens the documentation site. */
  onOpenDocs: () => void;
}

/**
 * Marketing landing page — matches the artist-delivered design at
 * https://1fef8c0e-…spock.replit.dev/. Header (logo + league nav +
 * theme toggle + Launch App) → hero → demo video → feature card
 * grid → FAQ accordion → footer. The Launch App button opens the app
 * on its home menu via `onLaunch`; each nav item deep-links through
 * `onNavigate`. Both flip the top-level route in App.tsx.
 *
 * The page is self-contained: no Privy auth, no API calls, no
 * routing library. Tailwind tokens follow the existing palette
 * (bg / text / panel-solid / accent / border-soft).
 */
export function LandingPage({ onLaunch, onNavigate, onOpenLegal, onOpenDocs }: Props) {
  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      <Header onLaunch={onLaunch} onNavigate={onNavigate} />
      <main className="flex-1 flex flex-col items-center px-5 sm:px-8 pt-10 pb-16">
        <Hero />
        <DemoVideo />
        <FeatureGrid />
        <FAQ />
      </main>
      <Footer onOpenLegal={onOpenLegal} onOpenDocs={onOpenDocs} />
    </div>
  );
}

function Header({ onLaunch, onNavigate }: Omit<Props, "onOpenLegal" | "onOpenDocs">) {
  const { theme, toggle } = useTheme();
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  return (
    <header className="border-b border-border-soft">
      <div className="flex items-center gap-4 lg:gap-6 px-5 sm:px-8 py-4">
        <div className="flex shrink-0 items-center gap-2.5">
          <Logo size={28} />
          <span className="text-[15px] font-semibold tracking-tight">Mantua</span>
        </div>
        <MarketNav onNavigate={onNavigate} className="hidden min-w-0 flex-1 md:block" />
        <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
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
      <MarketNav onNavigate={onNavigate} className="px-5 pb-3 md:hidden" />
    </header>
  );
}

/**
 * Hero is the delivered banner artwork itself — outlined-gradient MANTUA
 * with the leaf-M, divider flare, and the "Programmable Sports Agents"
 * tagline on the grid background, one PNG per theme. Using the art
 * verbatim keeps it pixel-identical.
 */
function Hero() {
  const { theme } = useTheme();
  return (
    <section className="w-full max-w-4xl pt-12 pb-4">
      <h1 className="sr-only">Mantua — Programmable Sports Agents</h1>
      {/* Both banners stay mounted in one fixed-aspect box and cross-fade —
          swapping src would reflow (the PNGs' ratios differ slightly) and
          flash while the other file decodes. */}
      <div
        className="relative w-full overflow-hidden rounded-xl"
        style={{ aspectRatio: "1882 / 836" }}
      >
        <img
          src="/assets/hero-banner.png"
          alt=""
          aria-hidden
          fetchPriority="high"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            theme === "dark" ? "opacity-100" : "opacity-0"
          }`}
        />
        <img
          src="/assets/hero-banner-light.png"
          alt=""
          aria-hidden
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            theme === "dark" ? "opacity-0" : "opacity-100"
          }`}
        />
      </div>
    </section>
  );
}

/**
 * The product demo video (/assets/demo.mp4, H.264). preload="metadata"
 * keeps the 32 MB file off the critical path — only the first frame and
 * duration load until the visitor hits play.
 */
function DemoVideo() {
  return (
    <section className="w-full max-w-4xl mt-6">
      <div
        className="rounded-xl border border-border-soft overflow-hidden"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(139,108,240,0.08), rgba(0,0,0,0))",
        }}
      >
        <video
          className="block w-full h-auto"
          controls
          playsInline
          preload="metadata"
          aria-label="Mantua demo video"
        >
          <source src="/assets/demo.mp4" type="video/mp4" />
        </video>
      </div>
    </section>
  );
}

interface Feature {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  status: "Live" | "Soon" | "Flagship";
  /** Full-width card in the two-column grid. */
  wide?: boolean;
}
/** Which surface a hook powers — prediction market or trading. */
function HookTag({ children }: { children: ReactNode }) {
  return (
    <span className="align-middle text-[10px] px-1.5 py-0.5 rounded-[4px] font-mono uppercase tracking-wider bg-chip text-text-mute border border-border-soft">
      {children}
    </span>
  );
}

const FEATURES: Feature[] = [
  {
    icon: <ShieldCheck className="h-4 w-4 text-accent" />,
    title: "Hooks",
    wide: true,
    body: (
      <ul className="space-y-2.5 list-disc list-outside pl-5 marker:text-text-mute">
        <li>
          <strong className="text-text">Dynamic Market Hook</strong>{" "}
          <HookTag>Prediction Market</HookTag> — automatically adapts pricing, fees, liquidity, and
          risk parameters in real time based on market conditions, volatility, and trading activity.
        </li>
        <li>
          <strong className="text-text">Stable Protection Hook</strong> <HookTag>Trading</HookTag> —
          a Mantua hook for stablecoin and dollar-pegged pools that monitors peg deviation across
          five zones, scaling LP fees to depeg severity and halting swaps entirely past 5%.
        </li>
        <li>
          <strong className="text-text">Dynamic Fee Hook</strong> <HookTag>Trading</HookTag> — a
          Mantua hook for volatile pairs that reads Chainlink price feeds and applies Nezlobin
          directional fees across five deviation zones, charging the toxic side of the trade more so
          LPs keep the spread instead of arbitrageurs.
        </li>
      </ul>
    ),
    status: "Flagship",
  },
  {
    icon: <Bot className="h-4 w-4 text-accent" />,
    title: "Agents",
    body: "Autonomous Agents turn intent into action. They buy the intelligence they need through the x402 marketplace, paying per call in USDC with capped, auditable spending and no API keys, then combine it with live sports and on-chain signals to independently research markets, place and manage bets, swap assets, provide liquidity, and manage positions without human intervention.",
    status: "Live",
  },
  {
    icon: <BarChart3 className="h-4 w-4 text-accent" />,
    title: "Analytics",
    body: "Real-time intelligence across sports markets, matchups, trading activity, and liquidity, turning live data into actionable insights.",
    status: "Live",
  },
  {
    icon: <Wallet className="h-4 w-4 text-accent" />,
    title: "Portfolio Management",
    body: "Unified portfolio management for users and agents, with real-time performance insights and autonomous on-chain position management.",
    status: "Live",
  },
  {
    icon: <CandlestickChart className="h-4 w-4 text-accent" />,
    title: "Trading & Liquidity",
    body: "Swap assets and provide liquidity across hook-powered Uniswap v4 pools, with real-time quotes, routing, and on-chain position management in one place.",
    status: "Live",
  },
];

function FeatureGrid() {
  return (
    <section className="w-full max-w-4xl mt-16">
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center mb-6">
        Key Features
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className={`bg-panel-solid border border-border-soft rounded-md p-5 ${
              f.wide ? "sm:col-span-2" : ""
            }`}
          >
            <div className="h-9 w-9 rounded-full bg-accent/15 flex items-center justify-center mb-3">
              {f.icon}
            </div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold">{f.title}</h3>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-[4px] font-mono uppercase tracking-wider ${
                  f.status === "Live"
                    ? "bg-green/10 text-green border border-green/30"
                    : f.status === "Flagship"
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : "bg-chip text-text-mute border border-border-soft"
                }`}
              >
                {f.status}
              </span>
            </div>
            <div className="text-[12.5px] text-text-dim leading-relaxed mt-2">{f.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface FAQItem {
  q: string;
  a: ReactNode;
}
const FAQS: FAQItem[] = [
  {
    q: "What is Mantua?",
    a: "Mantua is an agent-driven sports prediction market that allows bettors and market makers to open positions, provide liquidity, and execute automated hedging strategies through natural language. It combines Mantua hooks, autonomous AI agents, and real-time onchain execution to transform user intent into automated market actions. The result is a programmable liquidity layer for sports outcomes, live in-game markets, and USDC-settled event contracts.",
  },
  {
    q: "What problem does Mantua solve?",
    a: "Prediction markets are static. Odds and liquidity sit passively while the world moves, so market makers get picked off the moment news breaks and bettors trade against stale depth. Mantua makes the market itself programmable: fees adapt to order-flow imbalance, access is enforced at execution, and trading halts under conditions the market defines in advance. Bettors, market makers, and liquidity providers set all of it from natural-language instructions, executed onchain through agent-managed Mantua hooks.",
  },
  {
    q: "Why is Mantua better?",
    a: "Prediction markets today are passive, but Mantua makes them state-aware, fee-adaptive, oracle-enforced, and agent-managed by embedding these behaviors directly into AMM execution logic through Mantua hooks. By allowing AI agents to coordinate liquidity in response to real-time market conditions, Mantua transforms prediction-market liquidity from static capital into an automated financial control system for compliant access, market making, and event settlement.",
  },
  {
    q: "How do Mantua hooks work?",
    a: (
      <>
        <p>
          Mantua ships three hooks. Each plugs into the pool lifecycle to add behavior vanilla pools
          can&apos;t.
        </p>
        <ul className="mt-3 space-y-2.5 list-disc list-outside pl-5 marker:text-text-mute">
          <li>
            <strong className="text-text">Dynamic Market Hook</strong> — powers the prediction
            markets. Adapts pricing, fees, liquidity, and risk parameters in real time based on
            market conditions, volatility, and trading activity.
          </li>
          <li>
            <strong className="text-text">Stable Protection Hook</strong> — for stablecoin and
            dollar-pegged pools. Monitors peg deviation across five zones, scaling LP fees to depeg
            severity and halting swaps entirely past 5%. Pair: Stablecoins.
          </li>
          <li>
            <strong className="text-text">Dynamic Fee Hook</strong> — for volatile pairs. Reads
            Chainlink price feeds and applies Nezlobin directional fees across five deviation zones,
            charging the toxic side of the trade more so LPs keep the spread instead of
            arbitrageurs. Pairs: Volatile pairs.
          </li>
        </ul>
      </>
    ),
  },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="w-full max-w-3xl mt-20">
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center mb-6">
        Frequently Asked Questions
      </h2>
      <div className="space-y-2">
        {FAQS.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q} className="border border-border-soft rounded-md bg-panel-solid">
              <button
                type="button"
                onClick={() => {
                  setOpen(isOpen ? null : i);
                }}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left cursor-pointer"
                aria-expanded={isOpen}
              >
                <span className="text-[14px] font-semibold">{item.q}</span>
                <ChevronDown
                  className={`h-4 w-4 text-text-dim transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isOpen && (
                <div className="px-4 pb-4 text-[13px] text-text-dim leading-relaxed">{item.a}</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
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

function FooterLinks({ onOpenDocs }: { onOpenDocs: () => void }) {
  return (
    <div className="max-w-4xl mx-auto text-center">
      <button
        type="button"
        onClick={onOpenDocs}
        className="text-[13px] font-semibold text-text hover:text-accent transition-colors cursor-pointer"
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
                className="inline-flex items-center gap-1.5 text-text-dim hover:text-accent transition-colors"
              >
                <Icon className="h-[15px] w-[15px]" />
                {l.label}
              </a>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Footer({
  onOpenLegal,
  onOpenDocs,
}: {
  onOpenLegal: (doc: LegalDoc) => void;
  onOpenDocs: () => void;
}) {
  return (
    <footer className="border-t border-border-soft px-5 sm:px-8 py-8">
      <FooterLinks onOpenDocs={onOpenDocs} />

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
              className="hover:text-accent transition-colors cursor-pointer"
            >
              {l.label}
            </button>
          </span>
        ))}
      </div>
    </footer>
  );
}
