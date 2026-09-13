import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { TokenSymbol } from "./lib/tokens.ts";
import { detectIntent as detectIntentImpl, mentionsHook, type Intent } from "./lib/chat-intent.ts";
import { LandingPage } from "./components/landing/LandingPage.tsx";
import { LoginModal } from "./components/auth/LoginModal.tsx";
import { type NavDestination } from "./components/shell/MarketNav.tsx";
import { PrivacyPage } from "./components/legal/PrivacyPage.tsx";
import { TermsPage } from "./components/legal/TermsPage.tsx";
import { MarketIntegrityPage } from "./components/legal/MarketIntegrityPage.tsx";
import type { LegalDoc } from "./components/legal/LegalPage.tsx";
import { DocsPage } from "./components/docs/DocsPage.tsx";
import { LeaguePage } from "./features/markets/LeaguePage.tsx";
import { DiscoverPage } from "./features/markets/discover/DiscoverPage.tsx";
import type { DiscoverFilters } from "./features/markets/discovery.ts";
import { isSportId, type SportId } from "./features/markets/sports.ts";
import { rawToHuman6 } from "./features/markets/market-trade-core.ts";
import { QuickActions } from "./components/shell/QuickActions.tsx";
import { quickActionsFor, type QuickActionContext } from "./lib/quick-actions.ts";
import { AppShell } from "./components/shell/AppShell.tsx";
import { Card } from "./components/shell/Card.tsx";
import { HomePromptRow, type HomePromptId } from "./components/shell/HomeMenu.tsx";
import { InputBar } from "./components/shell/InputBar.tsx";
import { AgentPanel } from "./features/agent/AgentPanel.tsx";
import { AnalyzePanel } from "./features/analyze/AnalyzePanel.tsx";
import { PortfolioCard } from "./features/portfolio/PortfolioCard.tsx";
import { ProfilePage } from "./features/portfolio/ProfilePage.tsx";
import { Board } from "./features/markets/Board.tsx";
import { AssetsCard } from "./features/portfolio/AssetsCard.tsx";
import { AssetDetailPanel } from "./features/portfolio/AssetDetailPanel.tsx";
import { SwapPanel } from "./features/swap/SwapPanel.tsx";
import { AddLiquidityForm } from "./features/liquidity/AddLiquidityForm.tsx";
import type { AddLiquidityContext } from "./features/liquidity/AddLiquidityForm.tsx";
import type { HookName } from "./features/liquidity/use-create-pool.ts";
import { LiquidityListPage } from "./features/liquidity/LiquidityListPage.tsx";
import { PoolDetailPage } from "./features/liquidity/PoolDetailPage.tsx";
import { PositionsList } from "./features/liquidity/PositionsList.tsx";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";

type AnalyzeTopic =
  | "eth-price"
  | "eurc-peg"
  | "usdc-eurc-pool"
  | "top-stablecoins"
  | "cbbtc-24h-volume"
  | "mantua-hooks"
  | "token-price";

type Route =
  | { kind: "landing" }
  | { kind: "legal"; doc: LegalDoc }
  | { kind: "docs" }
  | { kind: "home" }
  | {
      kind: "swap";
      tokenIn?: TokenSymbol;
      tokenOut?: TokenSymbol;
      hook?: HookName | null;
      amountIn?: string;
      /** Venue tab to open on: hook pool, no-hook pool, or the bridge. */
      venue?: "hook" | "none" | "bridge";
      /** Bridge Kit sdkName of the destination chain (bridge venue). */
      bridgeDestination?: string;
      /** Bumped on every chat command so the panel remounts and re-applies
       *  the parsed tokens/hook/amount even when the route is otherwise
       *  identical — otherwise a repeated "swap USDC for EURC" does nothing. */
      nonce?: number;
    }
  | {
      kind: "market";
      sport: SportId;
      selectEventId?: string;
      /** Side to put in the ticket with `selectEventId` (a Discover price tap). */
      selectSide?: 0 | 1;
      /** Team hint from a position command ("bet on the Chiefs") — the
       *  league page resolves it against the slate (T-017). */
      selectTeam?: string;
      direction?: "buy" | "sell";
      /** Pre-filled ticket amount (human units) — one-click Close sends
       *  the full held balance. */
      amount?: string;
    }
  /** Task 050 — cross-league market discovery with filters (T-001/T-018). */
  | { kind: "discover"; filters?: DiscoverFilters }
  | { kind: "profile" }
  | { kind: "trading" }
  | { kind: "pools" }
  | { kind: "pool"; id: string }
  | { kind: "add-liquidity"; ctx?: AddLiquidityContext }
  | { kind: "positions" }
  | { kind: "asset"; symbol: TokenSymbol }
  | {
      kind: "analyze";
      topic?: AnalyzeTopic;
      question?: string;
      /** Free-form symbol to pass to the `token-price` runner. */
      symbol?: string;
    }
  | { kind: "agent"; message?: string };

// Intents that the manual Uniswap-v4 panels own when a hook is named.
const HOOK_ACTION_KINDS = new Set<Intent["kind"]>([
  "swap",
  "add-liquidity",
  "remove-liquidity",
  "create-pool",
]);
// Intents the Circle agent (no-hook) can execute itself when no hook is named.
const AGENT_ACTION_KINDS = new Set<Intent["kind"]>([
  "swap",
  "add-liquidity",
  "remove-liquidity",
  "send",
]);

// ─── Route persistence ────────────────────────────────────────────────────────
// The route lives only in React state, so a refresh used to bounce back to the
// landing page. Persist the last in-app route to sessionStorage and restore it
// on load: refresh keeps your place; a fresh tab/visit still starts at landing.
const ROUTE_STORAGE_KEY = "mantua:last-route";
const RESTORABLE_KINDS: readonly Route["kind"][] = [
  "home",
  "swap",
  "market",
  "discover",
  "profile",
  "trading",
  "pools",
  "pool",
  "add-liquidity",
  "positions",
  "asset",
  "analyze",
  "agent",
];

/** What we persist. Never store the public pages — landing and legal —
 *  (clear instead), and never store an agent `message`: restoring it would
 *  auto-resend the command on refresh (potentially re-executing a trade). */
function sanitizeRouteForStorage(route: Route): Route | null {
  if (route.kind === "landing" || route.kind === "legal" || route.kind === "docs") return null;
  if (route.kind === "agent") return { kind: "agent" };
  return route;
}

function loadStoredRoute(): Route | null {
  try {
    const raw = sessionStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kind?: unknown; sport?: unknown };
    if (
      typeof parsed.kind === "string" &&
      (RESTORABLE_KINDS as readonly string[]).includes(parsed.kind)
    ) {
      // A market route is only restorable with a league we still ship.
      if (parsed.kind === "market" && !isSportId(parsed.sport)) return null;
      return parsed as Route;
    }
  } catch {
    // Corrupt / unavailable storage → start fresh at landing.
  }
  return null;
}

export default function App() {
  const { ready, authenticated, logout, user } = usePrivy();
  const [route, setRoute] = useState<Route>(() => loadStoredRoute() ?? { kind: "landing" });
  const [showLogin, setShowLogin] = useState(false);
  // The game in view on a league page, for the dock's contextual quick
  // actions (T-016). Reported by LeaguePage; cleared when it unmounts.
  const [focusedGame, setFocusedGame] = useState<{ away: string; home: string } | null>(null);
  const onFocusGame = useCallback((game: { away: string; home: string } | null) => {
    setFocusedGame(game);
  }, []);

  // Any surface can request the login modal without prop-drilling —
  // league-page and dock gate buttons dispatch this event.
  useEffect(() => {
    const handler = () => {
      setShowLogin(true);
    };
    window.addEventListener("mantua:open-login", handler);
    return () => {
      window.removeEventListener("mantua:open-login", handler);
    };
  }, []);

  // Close-position deep-link from any positions list (profile, portfolio
  // card, market detail): open the league page with that game selected and
  // the sidebar on Sell, pre-filled with the full held balance (B7-003
  // one-click Close). `balance` is the raw 6dp holding.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ league?: string; eventId?: string; balance?: string }>)
        .detail;
      if (detail.league && isSportId(detail.league) && detail.eventId) {
        let amount: string | undefined;
        try {
          amount = detail.balance ? rawToHuman6(detail.balance) : undefined;
        } catch {
          amount = undefined; // unparseable balance — open on Sell without a pre-fill
        }
        setRoute({
          kind: "market",
          sport: detail.league,
          selectEventId: detail.eventId,
          direction: "sell",
          ...(amount ? { amount } : {}),
        });
      }
    };
    window.addEventListener("mantua:close-position", handler);
    return () => {
      window.removeEventListener("mantua:close-position", handler);
    };
  }, []);

  // Keep the stored route in sync so a refresh restores the current view.
  useEffect(() => {
    try {
      const sanitized = sanitizeRouteForStorage(route);
      if (sanitized) sessionStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(sanitized));
      else sessionStorage.removeItem(ROUTE_STORAGE_KEY);
    } catch {
      // Storage unavailable (private mode etc.) — refresh just returns to landing.
    }
  }, [route]);

  // PanelHeader's "New chat" button (rendered inside every panel)
  // falls back to this event when no `onNewChat` prop is wired —
  // letting any panel reset to the home menu without prop-drilling.
  useEffect(() => {
    const handler = () => {
      setRoute({ kind: "home" });
    };
    window.addEventListener("mantua:new-chat", handler);
    return () => {
      window.removeEventListener("mantua:new-chat", handler);
    };
  }, []);

  if (!ready) {
    return (
      <main className="min-h-screen bg-bg text-text flex items-center justify-center">
        <p className="text-sm text-text-dim">Loading…</p>
      </main>
    );
  }

  // Landing page is the default surface — public marketing copy with
  // no Privy auth attached. "Launch App" buttons hand off to the
  // existing in-app shell by flipping the route to `home`.
  if (route.kind === "landing") {
    return (
      <LandingPage
        onLaunch={() => {
          setRoute({ kind: "home" });
        }}
        onNavigate={(destination) => {
          setRoute(navDestinationToRoute(destination));
        }}
        onOpenLegal={(doc) => {
          setRoute({ kind: "legal", doc });
        }}
        onOpenDocs={() => {
          setRoute({ kind: "docs" });
        }}
      />
    );
  }

  if (route.kind === "docs") {
    return (
      <DocsPage
        onBack={() => {
          setRoute({ kind: "landing" });
        }}
        onLaunch={() => {
          setRoute({ kind: "home" });
        }}
      />
    );
  }

  // Legal pages are public too — same standalone treatment as landing.
  if (route.kind === "legal") {
    const back = () => {
      setRoute({ kind: "landing" });
    };
    const launch = () => {
      setRoute({ kind: "home" });
    };
    switch (route.doc) {
      case "privacy":
        return <PrivacyPage onBack={back} onLaunch={launch} />;
      case "terms":
        return <TermsPage onBack={back} onLaunch={launch} />;
      case "integrity":
        return <MarketIntegrityPage onBack={back} onLaunch={launch} />;
    }
  }

  const walletAddress = user?.wallet?.address;

  const handleConnect = () => {
    setShowLogin(true);
  };
  const handleDisconnect = () => {
    void logout();
  };

  // The universal command router — the dock at the bottom of every page
  // feeds this. A command only starts a mode, it never locks it: every
  // submission re-detects intent and routes to the right surface.
  const handleCommand = (text: string) => {
    // Freemium chat (owner decision 2026-08-18): logged-out users may ask
    // the ANALYST — three free questions, enforced server-side — but any
    // actionable command (trade, agent, liquidity…) demands login here.
    if (!authenticated) {
      const guest = detectIntent(text);
      // Browsing is free (B5-007): research, discovery, and league pages
      // open logged-out; anything that moves money asks for login.
      const browsing = new Set<Intent["kind"]>(["analyze", "discover", "market", "home"]);
      if (!guest || browsing.has(guest.kind)) {
        setRoute(guest ? intentToRoute(guest) : { kind: "analyze", question: text });
        return;
      }
      setShowLogin(true);
      return;
    }
    const intent = detectIntent(text);
    const hookNamed = mentionsHook(text);
    if (intent && HOOK_ACTION_KINDS.has(intent.kind) && hookNamed) {
      setRoute(intentToRoute(intent));
      return;
    }
    if (route.kind === "agent") {
      window.dispatchEvent(new CustomEvent("mantua:agent-input", { detail: text }));
      return;
    }
    if (intent && (AGENT_ACTION_KINDS.has(intent.kind) || intent.kind === "agent")) {
      setRoute({ kind: "agent", message: text });
      return;
    }
    if (route.kind === "analyze" && (!intent || intent.kind === "analyze")) {
      window.dispatchEvent(new CustomEvent("mantua:analyze-input", { detail: text }));
      return;
    }
    if (intent) {
      setRoute(intentToRoute(intent));
      return;
    }
    setRoute({ kind: "analyze", question: text });
  };

  return (
    <>
      <LoginModal
        open={showLogin}
        onClose={() => {
          setShowLogin(false);
        }}
      />
      <AppShell
        walletAddress={walletAddress}
        onLogin={authenticated ? undefined : handleConnect}
        onSignup={authenticated ? undefined : handleConnect}
        onDisconnect={authenticated ? handleDisconnect : undefined}
        onOpenProfile={() => {
          setRoute({ kind: "profile" });
        }}
        onOpenAgent={() => {
          setRoute({ kind: "agent" });
        }}
        onLogoClick={() => {
          setRoute({ kind: "landing" });
        }}
        onNavigate={(destination) => {
          setRoute(navDestinationToRoute(destination));
        }}
        onQuickAction={(id) => {
          setRoute(promptToRoute(id));
        }}
        full={fullPage(route, setRoute, onFocusGame)}
        dock={
          <>
            {/* T-015/T-016: the bar stays primary; chips feed the same handler. */}
            <QuickActions
              actions={quickActionsFor(quickActionContext(route, focusedGame))}
              onPick={handleCommand}
            />
            <InputBar
              onSubmit={handleCommand}
              placeholder={
                authenticated
                  ? undefined
                  : "Ask the analyst — 3 free questions. Log in to trade and do more"
              }
            />
          </>
        }
        left={<LeftColumn route={route} setRoute={setRoute} />}
        right={<RightColumn route={route} setRoute={setRoute} />}
      />
    </>
  );
}

function LeftColumn({ route, setRoute }: { route: Route; setRoute: (r: Route) => void }) {
  // B6-008 — the portfolio lives inside the profile, not as standalone nav:
  // opening Profile swaps the left column to balances + assets. Position and
  // asset drill-downs keep it too, since they read from it.
  if (
    route.kind === "profile" ||
    route.kind === "positions" ||
    route.kind === "asset" ||
    route.kind === "pool"
  ) {
    return (
      <>
        <PortfolioCard />
        <AssetsCard
          onSelectPool={(id) => {
            setRoute({ kind: "pool", id });
          }}
          onSelectAsset={(symbol) => {
            setRoute({ kind: "asset", symbol });
          }}
        />
      </>
    );
  }
  // B5-001 — everywhere else, the left column is the board: today's games
  // across the covered leagues, with the chat/panel column alongside
  // (B5-006). Browsing needs no login (B5-007).
  return (
    <Board
      onAnalyze={(question) => {
        // Free for everyone — the server meters 3 anonymous questions/day.
        setRoute({ kind: "analyze", question });
      }}
      onOpenLeague={(sport) => {
        setRoute({ kind: "market", sport: sport.id });
      }}
      onTrade={(sport) => {
        setRoute({ kind: "market", sport: sport.id });
      }}
    />
  );
}

function RightColumn({ route, setRoute }: { route: Route; setRoute: (r: Route) => void }) {
  return (
    <Card className="flex-1 flex flex-col p-0 overflow-hidden self-stretch" style={{ padding: 0 }}>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <RouteContent route={route} setRoute={setRoute} />
      </div>
    </Card>
  );
}

function RouteContent({ route, setRoute }: { route: Route; setRoute: (r: Route) => void }) {
  switch (route.kind) {
    // home renders as a full-screen page (see fullPage), like market /
    // trading / agent below.
    case "home":
      return null;
    // swap / pools / add-liquidity / analyze / market / trading / agent
    // render as full-screen pages (see fullPage); these cases exist only
    // because the element tree is still constructed in split mode for
    // every route kind.
    case "swap":
    case "pools":
    case "add-liquidity":
    case "analyze":
    case "market":
    case "discover":
    case "trading":
      return null;
    case "profile":
      return <ProfileRoute setRoute={setRoute} />;
    case "pool":
      return (
        <PoolDetailPage
          poolId={route.id}
          onBack={() => {
            setRoute({ kind: "pools" });
          }}
          onAddLiquidity={(ctx) => {
            setRoute({ kind: "add-liquidity", ctx: { ...ctx, locked: true } });
          }}
          onClose={() => {
            setRoute({ kind: "home" });
          }}
        />
      );
    case "positions":
      return (
        <PositionsList
          onClose={() => {
            setRoute({ kind: "home" });
          }}
        />
      );
    case "asset":
      return (
        <AssetDetailPanel
          key={route.symbol}
          symbol={route.symbol}
          onClose={() => {
            setRoute({ kind: "home" });
          }}
        />
      );
    case "agent":
      return null;
  }
}

/**
 * Full-screen routes (Polymarket-style surfaces): home, league pages, the
 * trading split, the agent, and the single-panel pages (analyze, swap,
 * pools, add-liquidity). Everything else keeps the two-column board +
 * panel shell. Returning undefined selects the split layout.
 */
function fullPage(
  route: Route,
  setRoute: (r: Route) => void,
  onFocusGame: (game: { away: string; home: string } | null) => void,
): React.ReactNode | undefined {
  const home = () => {
    setRoute({ kind: "home" });
  };
  switch (route.kind) {
    case "home":
      return <HomeFullPage setRoute={setRoute} />;
    case "market":
      return (
        <LeaguePage
          key={`${route.sport}-${route.selectEventId ?? ""}-${route.selectTeam ?? ""}`}
          sport={route.sport}
          initialEventId={route.selectEventId}
          initialSide={route.selectSide}
          initialTeam={route.selectTeam}
          initialDirection={route.direction}
          initialAmount={route.amount}
          onSelectSport={(sport) => {
            setRoute({ kind: "market", sport });
          }}
          onBack={home}
          onAgent={(message) => {
            setRoute({ kind: "agent", message });
          }}
          onViewPositions={() => {
            setRoute({ kind: "profile" });
          }}
          onFocusGame={onFocusGame}
        />
      );
    case "discover":
      return (
        <DiscoverPage
          filters={route.filters ?? {}}
          onChangeFilters={(filters) => {
            setRoute({ kind: "discover", filters });
          }}
          onOpenGame={(sport, eventId, side) => {
            setRoute({
              kind: "market",
              sport,
              selectEventId: eventId,
              ...(side !== null ? { selectSide: side } : {}),
            });
          }}
          onBack={home}
        />
      );
    case "trading":
      return <TradingFullPage setRoute={setRoute} />;
    case "agent":
      return (
        <PanelPage>
          <AgentPanel
            {...(route.message ? { initialMessage: route.message } : {})}
            onClose={home}
          />
        </PanelPage>
      );
    case "analyze":
      // No remount key: the panel is a persistent conversation thread. The
      // first query seeds turn 1 from these props; later input arrives via
      // the `mantua:analyze-input` event (see InputBar above) and appends.
      return (
        <PanelPage>
          <AnalyzePanel
            {...(route.topic ? { initialTopic: route.topic } : {})}
            {...(route.question ? { initialQuestion: route.question } : {})}
            {...(route.symbol ? { initialSymbol: route.symbol } : {})}
            onBack={home}
            onClose={home}
          />
        </PanelPage>
      );
    case "swap":
      return (
        <PanelPage>
          <SwapPanel
            // Remount per command so a fresh "swap …" re-applies tokens/hook/
            // amount even when the resulting route looks identical.
            key={`swap-${String(route.nonce ?? 0)}`}
            {...(route.tokenIn ? { initialTokenIn: route.tokenIn } : {})}
            {...(route.tokenOut ? { initialTokenOut: route.tokenOut } : {})}
            {...(route.hook ? { initialHook: route.hook } : {})}
            {...(route.amountIn ? { initialAmount: route.amountIn } : {})}
            {...(route.venue ? { initialVenue: route.venue } : {})}
            {...(route.bridgeDestination
              ? { initialBridgeDestination: route.bridgeDestination }
              : {})}
            onClose={home}
          />
        </PanelPage>
      );
    case "pools":
      return (
        <PanelPage wide>
          <LiquidityListPage
            onSelectPool={(id) => {
              setRoute({ kind: "pool", id });
            }}
            onCreate={() => {
              setRoute({ kind: "add-liquidity" });
            }}
            onSelectMarketPool={(market) => {
              setRoute({ kind: "add-liquidity", ctx: { market } });
            }}
            onClose={home}
          />
        </PanelPage>
      );
    case "add-liquidity":
      return <AddLiquidityFullPage route={route} setRoute={setRoute} />;
    default:
      return undefined;
  }
}

/** Full-page wrapper for the panels that used to live in the right column —
 *  a centered card; each panel keeps its own header and X-close home. */
function PanelPage({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className={`mx-auto flex h-full w-full ${wide ? "max-w-6xl" : "max-w-3xl"} flex-col px-6 py-6`}
    >
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ padding: 0 }}>
        {children}
      </Card>
    </div>
  );
}

/** Add-liquidity as a full page — a component so it can key the form on the
 *  chain id: a network switch remounts it and the useState initializers
 *  re-pick chain-aware defaults. */
function AddLiquidityFullPage({
  route,
  setRoute,
}: {
  route: Extract<Route, { kind: "add-liquidity" }>;
  setRoute: (r: Route) => void;
}) {
  const chainId = BASE_CHAIN_ID;
  return (
    <PanelPage>
      <AddLiquidityForm
        key={chainId}
        {...(route.ctx ? { ctx: route.ctx } : {})}
        onBack={() => {
          setRoute({ kind: "pools" });
        }}
        onClose={() => {
          setRoute({ kind: "home" });
        }}
      />
    </PanelPage>
  );
}

/** Home page — the four prompt cards in a row across the top (agent →
 *  analyze → swap → liquidity), then today's boards split side by side
 *  (NFL | WNBA) instead of stacked. Chat starts from the dock below. */
function HomeFullPage({ setRoute }: { setRoute: (r: Route) => void }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <HomePromptRow
        onPromptSelect={(id) => {
          setRoute(promptToRoute(id));
        }}
      />
      <div className="mt-5 grid items-start gap-5 md:grid-cols-2">
        <Board
          onAnalyze={(question) => {
            setRoute({ kind: "analyze", question });
          }}
          onOpenLeague={(sport) => {
            setRoute({ kind: "market", sport: sport.id });
          }}
          onTrade={(sport, eventId) => {
            setRoute({ kind: "market", sport: sport.id, selectEventId: eventId });
          }}
          onDiscover={() => {
            setRoute({ kind: "discover", filters: { status: "open" } });
          }}
        />
      </div>
    </div>
  );
}

/** B7-001/002 — full-width trading page: swap and liquidity side by side
 *  at equal height, pool list across the full width beneath. */
function TradingFullPage({ setRoute }: { setRoute: (r: Route) => void }) {
  const chainId = BASE_CHAIN_ID;
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="grid items-stretch gap-5 lg:grid-cols-2">
        <Card className="flex flex-col overflow-hidden" style={{ padding: 0 }}>
          <SwapPanel />
        </Card>
        <Card className="flex flex-col overflow-hidden" style={{ padding: 0 }}>
          <AddLiquidityForm
            key={`trading-${String(chainId)}`}
            onBack={() => {
              setRoute({ kind: "pools" });
            }}
          />
        </Card>
      </div>
      <Card className="mt-5 flex flex-col overflow-hidden" style={{ padding: 0 }}>
        <LiquidityListPage
          onSelectPool={(id) => {
            setRoute({ kind: "pool", id });
          }}
          onCreate={() => {
            setRoute({ kind: "add-liquidity" });
          }}
          onSelectMarketPool={(market) => {
            setRoute({ kind: "add-liquidity", ctx: { market } });
          }}
        />
      </Card>
    </div>
  );
}

/** Profile panel wrapper — owns the Privy handles the page needs. */
function ProfileRoute({ setRoute }: { setRoute: (r: Route) => void }) {
  const { user, logout } = usePrivy();
  return (
    <ProfilePage
      walletAddress={user?.wallet?.address}
      onViewPositions={() => {
        setRoute({ kind: "positions" });
      }}
      onOpenAgent={() => {
        setRoute({ kind: "agent" });
      }}
      onLogout={() => {
        void logout();
        setRoute({ kind: "home" });
      }}
      onClose={() => {
        setRoute({ kind: "home" });
      }}
    />
  );
}

/** Where each landing-header nav item lands in the app shell. */
function navDestinationToRoute(destination: NavDestination): Route {
  switch (destination.kind) {
    case "market":
      return { kind: "market", sport: destination.sport };
    case "agent":
      return { kind: "agent" };
    case "trading":
      return { kind: "trading" };
  }
}

function promptToRoute(id: HomePromptId): Route {
  switch (id) {
    case "pool":
      return { kind: "pools" };
    case "swap":
      return { kind: "swap" };
    case "analyze":
      return { kind: "analyze" };
    case "agent":
      return { kind: "agent" };
  }
}

/**
 * Re-export of the pure intent matcher from `lib/chat-intent.ts`.
 * The returned `Intent` goes through `intentToRoute()` below to land
 * on a concrete `Route` — the two unions don't line up shape-for-
 * shape (Intent has create-pool / remove-liquidity / send / portfolio
 * kinds that collapse into a smaller Route set).
 */
function detectIntent(text: string): Intent | null {
  return detectIntentImpl(text);
}

/**
 * Map a parsed `Intent` (from the chat NLP layer) onto a concrete
 * `Route` (what `RouteContent` knows how to render). Most Intent kinds
 * have a 1:1 Route counterpart; the kinds that don't yet collapse to
 * the closest existing panel:
 *
 * - `create-pool` → `add-liquidity` — the AddLiquidityForm already
 *   handles create-or-add via its calldata flow (initialize the pool
 *   if missing, then add liquidity).
 * - `remove-liquidity` → `positions` — per-position deep-linking
 *   needs a pool/position id we don't extract yet; PositionsList lets
 *   the user pick which position to remove.
 * - `send` → `agent` — the conversational agent handles sends.
 * - `portfolio` → `profile` — the profile surfaces PortfolioCard
 *   + AssetsCard.
 *
 * As deep-link surfaces land (send Route, etc.), the corresponding
 * `case` here is the only place that needs to change — the parser
 * is already producing the richer intent.
 */
// Monotonic id so each chat command yields a distinct swap route, forcing
// the swap panel to remount and re-apply the parsed tokens/hook/amount.
let swapNonce = 0;
function nextSwapNonce(): number {
  swapNonce += 1;
  return swapNonce;
}

function intentToRoute(intent: Intent): Route {
  switch (intent.kind) {
    case "home":
      return { kind: "home" };
    case "swap":
      return {
        kind: "swap",
        ...(intent.tokenIn ? { tokenIn: intent.tokenIn } : {}),
        ...(intent.tokenOut ? { tokenOut: intent.tokenOut } : {}),
        // Only forward an explicitly-named hook; otherwise let the panel
        // pick its pair recommendation.
        ...(intent.hook ? { hook: intent.hook } : {}),
        ...(intent.amountIn ? { amountIn: intent.amountIn } : {}),
        nonce: nextSwapNonce(),
      };
    case "pools":
      return { kind: "pools" };
    case "add-liquidity":
    case "create-pool":
      return intent.ctx ? { kind: "add-liquidity", ctx: intent.ctx } : { kind: "add-liquidity" };
    case "remove-liquidity":
      return { kind: "positions" };
    case "positions":
      return { kind: "positions" };
    case "send":
      return { kind: "agent" };
    case "agent":
      return { kind: "agent", ...(intent.message ? { message: intent.message } : {}) };
    case "portfolio":
      return { kind: "profile" };
    case "market":
      return { kind: "market", sport: intent.sport };
    case "position":
      // Land on the league's market page (NFL when no league was named);
      // a team hint preselects that game and side (T-017), and a close
      // opens the ticket on Sell.
      return {
        kind: "market",
        sport: intent.sport ?? "nfl",
        ...(intent.team ? { selectTeam: intent.team } : {}),
        ...(intent.action === "close" ? { direction: "sell" as const } : {}),
      };
    case "discover":
      return { kind: "discover", filters: intent.filters };
    case "analyze":
      return {
        kind: "analyze",
        ...(intent.topic ? { topic: intent.topic } : {}),
        ...(intent.question ? { question: intent.question } : {}),
        ...(intent.symbol ? { symbol: intent.symbol } : {}),
      };
    case "bridge":
      // Bridging lives inside the Swap panel as its third venue — a bridge
      // command opens Swap with the Bridge tab selected and prefilled.
      return {
        kind: "swap",
        venue: "bridge",
        ...(intent.amount ? { amountIn: intent.amount } : {}),
        ...(intent.destination ? { bridgeDestination: intent.destination } : {}),
        nonce: nextSwapNonce(),
      };
  }
}

/** The dock's quick-action context for the current surface (T-016). */
function quickActionContext(
  route: Route,
  focusedGame: { away: string; home: string } | null,
): QuickActionContext {
  switch (route.kind) {
    case "market":
      return { kind: "market", sport: route.sport, ...(focusedGame ? { game: focusedGame } : {}) };
    case "home":
    case "discover":
    case "analyze":
    case "swap":
    case "pools":
    case "profile":
    case "agent":
      return { kind: route.kind };
    default:
      return { kind: "other" };
  }
}
