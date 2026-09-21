import { Suspense, lazy, useEffect, useState } from "react";
import { useIsMobile } from "./hooks/use-media-query.ts";
import {
  launchedFromInstalledApp,
  parseLaunchParams,
  stripLaunchParams,
  type LaunchTarget,
} from "./lib/launch-route.ts";
import { InstallBanner } from "./features/pwa/InstallBanner.tsx";
import {
  AgentPanel,
  AnalyzePanel,
  AssetDetailPanel,
  AssetsCard,
  DocsPage,
  HistoryPage,
  MarketIntegrityPage,
  MobileProfile,
  PortfolioCard,
  PrivacyPage,
  ProfilePage,
  TermsPage,
} from "./app-lazy.ts";
import { usePrivy } from "@privy-io/react-auth";
import type { TokenSymbol } from "./lib/tokens.ts";
import { detectIntent as detectIntentImpl, type Intent } from "./lib/chat-intent.ts";
import { agentInputEvent } from "./features/voice/spoken-command.ts";
import { LoginModal } from "./components/auth/LoginModal.tsx";
import { Footer } from "./components/shell/Footer.tsx";
import { type NavDestination } from "./components/shell/MarketNav.tsx";
import type { LegalDoc } from "./components/legal/LegalPage.tsx";
import { LeaguePage } from "./features/markets/LeaguePage.tsx";
import { DiscoverPage } from "./features/markets/discover/DiscoverPage.tsx";
import type { DiscoverFilters } from "./features/markets/discovery.ts";
import { isSportId, type SportId } from "./features/markets/sports.ts";
import { rawToHuman6 } from "./features/markets/market-trade-core.ts";
import { AppShell } from "./components/shell/AppShell.tsx";
import { Card } from "./components/shell/Card.tsx";
import { HomePromptRow, type HomePromptId } from "./components/shell/HomeMenu.tsx";
import { InputBar } from "./components/shell/InputBar.tsx";
// Task 070 (Phase 13) — the public performance page, the agent's voice, support.
import { PublicAgentPage } from "./features/reputation/PublicAgentPage.tsx";
import { agentHandleFromPath, agentPagePath } from "./features/reputation/reputation-core.ts";
import { SocialPanel } from "./features/social/SocialPanel.tsx";
import { SupportPanel } from "./features/support/SupportPanel.tsx";
import { PanelLoading } from "./components/shell/PanelLoading.tsx";
import { SPORTS } from "./features/markets/sports.ts";
/** Where "Add legs from a league" lands: the first tradable league. */
const DEFAULT_SPORT = (SPORTS.find((s) => s.coverage === "launch") ?? SPORTS[0]).id;
// Task 072 — off the critical path (mobile budget MX-006): loaded on first open.
const ComboBuilder = lazy(() =>
  import("./features/combos/ComboBuilder.tsx").then((m) => ({ default: m.ComboBuilder })),
);
import { Board } from "./features/markets/Board.tsx";

type Route =
  | { kind: "legal"; doc: LegalDoc }
  | { kind: "docs" }
  | { kind: "home" }
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
  | { kind: "history"; league?: SportId }
  | { kind: "profile" }
  | { kind: "asset"; symbol: TokenSymbol }
  | { kind: "analyze"; question?: string }
  | {
      kind: "agent";
      message?: string;
      /** Task 069 (V-009) — the seed message came from speech. */
      spoken?: boolean;
    }
  /** Task 070 — the public performance page at `/agents/<handle>` (no login). */
  | { kind: "agent-public"; handle: string }
  /** Task 070 — the agent's voice: handle, posting policy, approval queue. */
  | { kind: "social" }
  /** Task 070 — help & support, signed in or not. */
  | { kind: "support" }
  /** Task 072 — the Combo Builder (legs picked from league pages). */
  | { kind: "combos" };

// ─── Route persistence ────────────────────────────────────────────────────────
// The route lives only in React state, so a refresh used to bounce back to
// home. Persist the last in-app route to sessionStorage and restore it on
// load: refresh keeps your place; a fresh tab/visit still starts at home.
const ROUTE_STORAGE_KEY = "mantua:last-route";
const RESTORABLE_KINDS: readonly Route["kind"][] = [
  "home",
  "market",
  "discover",
  "profile",
  "history",
  "asset",
  "analyze",
  "agent",
  "social",
  "support",
  "combos",
];

/** What we persist. Never store the standalone public pages — legal, docs,
 *  an agent's public page (its URL is the record) — (clear instead), and
 *  never store an agent `message`: restoring it would auto-resend the
 *  command on refresh (potentially re-executing a trade). */
function sanitizeRouteForStorage(route: Route): Route | null {
  if (route.kind === "legal" || route.kind === "docs" || route.kind === "agent-public") return null;
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
    // Corrupt / unavailable storage → start fresh at home.
  }
  return null;
}

export default function App() {
  const { ready, authenticated, logout, user } = usePrivy();
  // Task 070 — `/agents/<handle>` is the one URL the app answers directly:
  // a shared link must open the public record, not the home page.
  // Task 071 (MX-004 / MX-007) — a notification tap or a home-screen
  // shortcut names its surface in the query.
  // Task 075 (Phase 19) — `/` is the one front door: no landing page, no
  // stored/launch route falls back to anything but `home`.
  const [route, setRoute] = useState<Route>(() => {
    const handle = agentHandleFromPath(window.location.pathname);
    if (handle) return { kind: "agent-public", handle };
    return launchRoute(window.location.search) ?? loadStoredRoute() ?? { kind: "home" };
  });
  const isMobile = useIsMobile();
  useEffect(() => {
    const clean = stripLaunchParams(window.location.href);
    if (clean !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, "", clean);
    }
  }, []);
  const [showLogin, setShowLogin] = useState(false);

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

  // Task 070 — the header's help button and any surface can open support
  // without prop-drilling, like the login modal.
  useEffect(() => {
    const handler = () => {
      setRoute({ kind: "support" });
    };
    window.addEventListener("mantua:open-support", handler);
    return () => {
      window.removeEventListener("mantua:open-support", handler);
    };
  }, []);

  // Task 072 — `+ Combo` on a game row and the executed card open the
  // builder / the profile without prop-drilling, like support above.
  useEffect(() => {
    const openCombos = () => {
      setRoute({ kind: "combos" });
    };
    const openProfile = () => {
      setRoute({ kind: "profile" });
    };
    window.addEventListener("mantua:open-combos", openCombos);
    window.addEventListener("mantua:open-profile", openProfile);
    return () => {
      window.removeEventListener("mantua:open-combos", openCombos);
      window.removeEventListener("mantua:open-profile", openProfile);
    };
  }, []);

  // Task 070 — keep the address bar honest for the one shareable route: the
  // public page carries its handle; leaving it returns to the root.
  useEffect(() => {
    const wanted = route.kind === "agent-public" ? agentPagePath(route.handle) : "/";
    if (
      window.location.pathname !== wanted &&
      (route.kind === "agent-public" || agentHandleFromPath(window.location.pathname))
    ) {
      window.history.replaceState(null, "", wanted);
    }
  }, [route]);

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

  // The ticket's Terms gate (task 067) opens the legal page without
  // prop-drilling, like the login modal.
  useEffect(() => {
    const handler = (e: Event) => {
      const doc = (e as CustomEvent<string>).detail;
      if (doc === "terms" || doc === "privacy" || doc === "integrity") {
        setRoute({ kind: "legal", doc });
      }
    };
    window.addEventListener("mantua:open-legal", handler);
    return () => {
      window.removeEventListener("mantua:open-legal", handler);
    };
  }, []);

  // Keep the stored route in sync so a refresh restores the current view.
  useEffect(() => {
    try {
      const sanitized = sanitizeRouteForStorage(route);
      if (sanitized) sessionStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(sanitized));
      else sessionStorage.removeItem(ROUTE_STORAGE_KEY);
    } catch {
      // Storage unavailable (private mode etc.) — refresh just returns to home.
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

  // Task 070 — an agent's public record is a public page, like docs.
  if (route.kind === "agent-public") {
    return (
      <PublicAgentPage
        handle={route.handle}
        onBack={() => {
          setRoute({ kind: "home" });
        }}
        onLaunch={() => {
          setRoute({ kind: "home" });
        }}
      />
    );
  }

  if (route.kind === "docs") {
    return (
      <DocsPage
        onBack={() => {
          setRoute({ kind: "home" });
        }}
        onLaunch={() => {
          setRoute({ kind: "home" });
        }}
      />
    );
  }

  // Legal pages are public, standalone — reached from the home footer now.
  if (route.kind === "legal") {
    const back = () => {
      setRoute({ kind: "home" });
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
  const handleCommand = (text: string, spoken = false) => {
    // There is one chatbot: while the support panel is open, the dock is
    // its input (signed in or not — support answers everyone).
    if (route.kind === "support") {
      window.dispatchEvent(new CustomEvent("mantua:support-input", { detail: text }));
      return;
    }
    // Freemium chat (owner decision 2026-08-18): logged-out users may ask
    // the ANALYST — three free questions, enforced server-side — but any
    // actionable command (trade, agent, portfolio…) demands login here.
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
    if (route.kind === "agent") {
      window.dispatchEvent(agentInputEvent({ text, spoken }));
      return;
    }
    if (intent?.kind === "agent") {
      setRoute({ kind: "agent", message: text, spoken });
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
          setRoute({ kind: "home" });
        }}
        onNavigate={(destination) => {
          setRoute(navDestinationToRoute(destination));
        }}
        onQuickAction={(id) => {
          setRoute(promptToRoute(id));
        }}
        activeSport={route.kind === "market" ? route.sport : null}
        full={fullPage(route, setRoute, isMobile)}
        dock={
          <>
            <InstallBanner />
            <InputBar
              onSubmit={handleCommand}
              placeholder={
                route.kind === "support"
                  ? "Ask support a question or describe the problem"
                  : authenticated
                    ? undefined
                    : "Ask the analyst — 3 free questions. Log in to trade and do more"
              }
            />
          </>
        }
        // Task 075 — the home page's footer sits under the dock, at the very
        // bottom of the page, so it never separates the board from the chat.
        footer={
          route.kind === "home" ? (
            <Footer
              onOpenDocs={() => {
                setRoute({ kind: "docs" });
              }}
              onOpenLegal={(doc) => {
                setRoute({ kind: "legal", doc });
              }}
            />
          ) : undefined
        }
        left={<LeftColumn route={route} setRoute={setRoute} />}
        right={<RightColumn route={route} setRoute={setRoute} />}
      />
    </>
  );
}

function LeftColumn({ route, setRoute }: { route: Route; setRoute: (r: Route) => void }) {
  // B6-008 — the portfolio lives inside the profile, not as standalone nav:
  // opening Profile swaps the left column to balances + assets. The asset
  // drill-down keeps it too, since it reads from it.
  if (route.kind === "profile" || route.kind === "asset") {
    return (
      <>
        <PortfolioCard />
        <AssetsCard
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
    // agent below.
    case "home":
      return null;
    // analyze / market / discover / history / agent / social / support /
    // combos render as full-screen pages (see fullPage); these cases exist
    // only because the element tree is still constructed in split mode for
    // every route kind.
    case "analyze":
    case "market":
    case "discover":
    case "history":
    case "social":
    case "support":
    case "combos":
      return null;
    case "profile":
      return <ProfileRoute setRoute={setRoute} />;
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
    case "agent-public":
      return null;
  }
}

/**
 * Full-screen routes (Polymarket-style surfaces): home, league pages, the
 * agent, and the single-panel pages (analyze, discover, history, combos).
 * Everything else keeps the two-column board + panel shell. Returning
 * undefined selects the split layout.
 */
function fullPage(
  route: Route,
  setRoute: (r: Route) => void,
  mobile: boolean,
): React.ReactNode | undefined {
  const home = () => {
    setRoute({ kind: "home" });
  };
  switch (route.kind) {
    case "home":
      return <HomeFullPage setRoute={setRoute} />;
    case "profile":
      // Task 071 (MX-008) — on phones the profile is one tabbed page rather
      // than a stacked portfolio column above the account panel.
      return mobile ? <MobileProfileRoute setRoute={setRoute} /> : undefined;
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
          onBrowseHistory={() => {
            setRoute({ kind: "history", league: route.sport });
          }}
        />
      );
    case "history":
      return (
        <HistoryPage
          league={route.league ?? null}
          onChangeLeague={(league) => {
            setRoute({ kind: "history", ...(league ? { league } : {}) });
          }}
          onBack={home}
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
          onBrowseHistory={() => {
            setRoute({ kind: "history" });
          }}
        />
      );
    case "agent":
      return (
        <PanelPage>
          <AgentPanel
            {...(route.message ? { initialMessage: route.message } : {})}
            {...(route.spoken ? { initialSpoken: true } : {})}
            onClose={home}
          />
        </PanelPage>
      );
    case "social":
      return (
        <PanelPage>
          <SocialPanel
            onClose={home}
            onOpenPublicPage={(handle) => {
              setRoute({ kind: "agent-public", handle });
            }}
          />
        </PanelPage>
      );
    case "support":
      return (
        <PanelPage>
          <SupportPanel onClose={home} />
        </PanelPage>
      );
    case "combos":
      return (
        <PanelPage>
          <Suspense fallback={<PanelLoading />}>
            <ComboBuilder
              onClose={home}
              onBrowse={() => {
                setRoute({ kind: "market", sport: DEFAULT_SPORT });
              }}
            />
          </Suspense>
        </PanelPage>
      );
    case "analyze":
      // No remount key: the panel is a persistent conversation thread. The
      // first query seeds turn 1 from these props; later input arrives via
      // the `mantua:analyze-input` event (see InputBar above) and appends.
      return (
        <PanelPage>
          <AnalyzePanel
            {...(route.question ? { initialQuestion: route.question } : {})}
            onBack={home}
            onClose={home}
          />
        </PanelPage>
      );
    default:
      return undefined;
  }
}

/** Full-page wrapper for the panels that used to live in the right column —
 *  a centered card; each panel keeps its own header and X-close home. */
function PanelPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-3 py-3 md:px-6 md:py-6">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ padding: 0 }}>
        {children}
      </Card>
    </div>
  );
}

/** Home page — the two prompt cards across the top (agent → analyze), then
 *  today's NFL board full width. The footer (task 075 — the one front
 *  door: docs, social and the legal links the Terms gate depends on, none
 *  of it behind login) renders under the dock via `AppShell`'s `footer`
 *  slot, at the very bottom of the page. Chat starts from the dock. */
function HomeFullPage({ setRoute }: { setRoute: (r: Route) => void }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 md:px-6 md:py-6">
      <HomePromptRow
        onPromptSelect={(id) => {
          setRoute(promptToRoute(id));
        }}
      />
      <div className="mt-5 grid items-start gap-5">
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

/** Task 071 (MX-008) — the phone profile: positions, portfolio, agent, account as tabs. */
function MobileProfileRoute({ setRoute }: { setRoute: (r: Route) => void }) {
  const { user, logout } = usePrivy();
  return (
    <MobileProfile
      walletAddress={user?.wallet?.address}
      onOpenAgent={() => {
        setRoute({ kind: "agent" });
      }}
      onOpenSocial={() => {
        setRoute({ kind: "social" });
      }}
      onSelectAsset={(symbol) => {
        setRoute({ kind: "asset", symbol });
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

/** Task 071 — the URL's launch target as a Route (see lib/launch-route.ts). */
function launchRoute(search: string): Route | null {
  const target: LaunchTarget | null = parseLaunchParams(search);
  if (!target) return launchedFromInstalledApp(search) ? { kind: "home" } : null;
  switch (target.kind) {
    case "market":
      return {
        kind: "market",
        sport: target.league,
        ...(target.eventId ? { selectEventId: target.eventId } : {}),
        ...(target.side !== undefined ? { selectSide: target.side } : {}),
      };
    case "discover":
      return { kind: "discover", filters: { status: "open" } };
    case "profile":
    case "agent":
    case "home":
      return { kind: target.kind };
  }
}

/** Profile panel wrapper — owns the Privy handles the page needs. */
function ProfileRoute({ setRoute }: { setRoute: (r: Route) => void }) {
  const { user, logout } = usePrivy();
  return (
    <ProfilePage
      walletAddress={user?.wallet?.address}
      onOpenAgent={() => {
        setRoute({ kind: "agent" });
      }}
      onOpenSocial={() => {
        setRoute({ kind: "social" });
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

/** Where each header nav item lands in the app shell. */
function navDestinationToRoute(destination: NavDestination): Route {
  switch (destination.kind) {
    case "market":
      return { kind: "market", sport: destination.sport };
    case "agent":
      return { kind: "agent" };
    case "combos":
      return { kind: "combos" };
  }
}

function promptToRoute(id: HomePromptId): Route {
  switch (id) {
    case "analyze":
      return { kind: "analyze" };
    case "agent":
      return { kind: "agent" };
    case "combos":
      return { kind: "combos" };
  }
}

/**
 * Re-export of the pure intent matcher from `lib/chat-intent.ts`.
 * The returned `Intent` goes through `intentToRoute()` below to land
 * on a concrete `Route`.
 */
function detectIntent(text: string): Intent | null {
  return detectIntentImpl(text);
}

/**
 * Map a parsed `Intent` (from the chat NLP layer) onto a concrete
 * `Route` (what `RouteContent` knows how to render). `portfolio` lands on
 * `profile` — the profile surfaces PortfolioCard + AssetsCard.
 */
function intentToRoute(intent: Intent): Route {
  switch (intent.kind) {
    case "home":
      return { kind: "home" };
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
      return { kind: "analyze", ...(intent.question ? { question: intent.question } : {}) };
  }
}
