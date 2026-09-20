/**
 * Task 071 (MX-006) — the surfaces a phone opens rarely, or never, load on
 * demand. Everything below is a `React.lazy` boundary; the shell renders a
 * one-line placeholder while the chunk arrives (AppShell's Suspense). The
 * first paint pays for the board, the league page and the ticket only.
 *
 * The heavy vendor libraries these pull (charts, Plaid) are split into
 * their own chunks in vite.config.ts, so they leave the critical path with
 * the surfaces that need them.
 */
import { lazy } from "react";

export const AssetDetailPanel = lazy(() =>
  import("./features/portfolio/AssetDetailPanel.tsx").then((m) => ({
    default: m.AssetDetailPanel,
  })),
);
export const PortfolioCard = lazy(() =>
  import("./features/portfolio/PortfolioCard.tsx").then((m) => ({ default: m.PortfolioCard })),
);
export const AssetsCard = lazy(() =>
  import("./features/portfolio/AssetsCard.tsx").then((m) => ({ default: m.AssetsCard })),
);
export const ProfilePage = lazy(() =>
  import("./features/portfolio/ProfilePage.tsx").then((m) => ({ default: m.ProfilePage })),
);
export const MobileProfile = lazy(() =>
  import("./features/portfolio/MobileProfile.tsx").then((m) => ({ default: m.MobileProfile })),
);
export const AnalyzePanel = lazy(() =>
  import("./features/analyze/AnalyzePanel.tsx").then((m) => ({ default: m.AnalyzePanel })),
);
export const AgentPanel = lazy(() =>
  import("./features/agent/AgentPanel.tsx").then((m) => ({ default: m.AgentPanel })),
);
export const HistoryPage = lazy(() =>
  import("./features/markets/history/HistoryPage.tsx").then((m) => ({ default: m.HistoryPage })),
);
export const DocsPage = lazy(() =>
  import("./components/docs/DocsPage.tsx").then((m) => ({ default: m.DocsPage })),
);
export const PrivacyPage = lazy(() =>
  import("./components/legal/PrivacyPage.tsx").then((m) => ({ default: m.PrivacyPage })),
);
export const TermsPage = lazy(() =>
  import("./components/legal/TermsPage.tsx").then((m) => ({ default: m.TermsPage })),
);
export const MarketIntegrityPage = lazy(() =>
  import("./components/legal/MarketIntegrityPage.tsx").then((m) => ({
    default: m.MarketIntegrityPage,
  })),
);
