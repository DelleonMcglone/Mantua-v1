import express from "express";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger.ts";
import { attachAuth } from "./middleware/auth.ts";
import { killSwitch } from "./middleware/kill-switch.ts";
import { securityHeaders } from "./middleware/security-headers.ts";
import { ipRateLimiter } from "./middleware/rate-limit.ts";
import { agentChatRouter } from "./routes/agent-chat.ts";
import { cspReportRouter } from "./routes/csp-report.ts";
import { agentInstructionRouter } from "./routes/agent-instruction.ts";
import { agentLiquidityRouter } from "./routes/agent-liquidity.ts";
import { agentPortfolioRouter } from "./routes/agent-portfolio.ts";
import { agentUnifiedBalanceRouter } from "./routes/agent-unified-balance.ts";
import { cronRebalanceRouter } from "./routes/cron-rebalance.ts";
import { cronPegSyncRouter } from "./routes/cron-peg-sync.ts";
import { cronSportsSyncRouter } from "./routes/cron-sports-sync.ts";
import { adminSpPoolRouter } from "./routes/admin-sp-pool.ts";
import { sportsSlateRouter } from "./routes/sports-slate.ts";
import { strategiesRouter } from "./routes/strategies.ts";
import { marketTradeRouter } from "./routes/market-trade.ts";
import { marketPositionsRouter } from "./routes/market-positions.ts";
import { marketFillsRouter } from "./routes/market-fills.ts";
import { marketDetailRouter } from "./routes/market-detail.ts";
import { marketAnalysisRouter } from "./routes/market-analysis.ts";
import { marketDepthRouter } from "./routes/market-depth.ts";
import { marketHistoryRouter } from "./routes/market-history.ts";
import { voiceTokenRouter } from "./routes/voice-token.ts";
import { pushRouter } from "./routes/push.ts";
import { marketDiscoverRouter } from "./routes/market-discover.ts";
import { legalRouter } from "./routes/legal.ts";
import { marketRedeemRouter } from "./routes/market-redeem.ts";
import { activityRouter } from "./routes/activity.ts";
import { portfolioEconomicsRouter } from "./routes/portfolio-economics.ts";
import { cronStrategiesRouter } from "./routes/cron-strategies.ts";
import { combosRouter } from "./routes/combos.ts";
import { combosTradeRouter } from "./routes/combos-trade.ts";
import { cronCombosRouter } from "./routes/cron-combos.ts";
import { cronResolutionRouter } from "./routes/cron-resolution.ts";
import { resolutionOpsRouter } from "./routes/resolution-ops.ts";
import { cronIntentsRouter } from "./routes/cron-intents.ts";
import { circleWebhookRouter } from "./routes/circle-webhook.ts";
import { fiatWebhookRouter } from "./routes/fiat-webhook.ts";
import { x402ServiceRouter } from "./routes/x402-service.ts";
// Phase 17 (MP-004/007) — the paid /api/x402/v1 services (dual-rail paywall).
// Mounted among the app routers so the C-020 kill switch covers them.
import { x402TradingRouter } from "./routes/x402-trading.ts";
// Phase 17 (MP-005/006) — the paid discovery and intelligence reads.
import { x402DiscoveryRouter } from "./routes/x402-discovery.ts";
import { x402IntelligenceRouter } from "./routes/x402-intelligence.ts";
import { agentQueryRouter } from "./routes/agent-query.ts";
import { agentSendRouter } from "./routes/agent-send.ts";
import { agentSwapRouter } from "./routes/agent-swap.ts";
import { agentWalletsRouter } from "./routes/agent-wallets.ts";
import { agentPolicyRouter } from "./routes/agent-policy.ts";
import { agentPerformanceRouter } from "./routes/agent-performance.ts";
import { commandParseRouter } from "./routes/command-parse.ts";
import { analyticsRouter } from "./routes/analytics.ts";
import { analyzeRouter } from "./routes/analyze.ts";
import { analyzeChatRouter } from "./routes/analyze-chat.ts";
// Task 070 (Phase 13) — social posting, the public ledger, AI support.
import { agentSocialRouter } from "./routes/agent-social.ts";
import { agentsPublicRouter } from "./routes/agents-public.ts";
import { cronSocialPostsRouter } from "./routes/cron-social-posts.ts";
import { supportChatRouter } from "./routes/support-chat.ts";
import { healthRouter } from "./routes/health.ts";
import { liquidityAddRouter } from "./routes/liquidity-add.ts";
import { liquidityRemoveRouter } from "./routes/liquidity-remove.ts";
import { marketMetricsRouter } from "./routes/market-metrics.ts";
import { marketPoolsRouter } from "./routes/market-pools.ts";
import { poolCreateRouter } from "./routes/pool-create.ts";
import { poolStateRouter } from "./routes/pool-state.ts";
import { poolsRouter } from "./routes/pools.ts";
import { rpcProxyRouter } from "./routes/rpc-proxy.ts";
import { earningsRouter } from "./routes/earnings.ts";
import { portfolioRouter } from "./routes/portfolio.ts";
import { positionsRouter } from "./routes/positions.ts";
import { quoteRouter } from "./routes/quote.ts";
import { swapRouter } from "./routes/swap.ts";
import { tokenPricesRouter } from "./routes/token-prices.ts";
import { pairPriceChartRouter } from "./routes/pair-price-chart.ts";
import { v4SwapRouter } from "./routes/v4-swap.ts";
import { fiatRailsRouter } from "./routes/fiat-rails.ts";
import { platformStatusRouter } from "./routes/platform-status.ts";
import { liveStreamRouter } from "./routes/live-stream.ts";
import { cronLiveSyncRouter } from "./routes/cron-live-sync.ts";
import { opsMetricsRouter } from "./routes/ops-metrics.ts";
import { latencyMiddleware } from "./lib/metrics.ts";

/**
 * Express app factory, shared by the standalone server (`index.ts`,
 * local dev) and the Vercel serverless entrypoint (`api/index.ts`).
 * Keeping route/middleware registration here means both run identical
 * wiring — the only difference is `index.ts` calls `.listen()`.
 */
export const app = express();
app.set("trust proxy", 1);
// Task 067 (G-006) — security headers before anything else answers.
app.use(securityHeaders);
app.use(pinoHttp({ logger }));
// Phase 7 / R-003 — time the budgeted routes from the edge of Express.
app.use(latencyMiddleware);
// C-015 — Circle webhook finalizer. Mounted BEFORE express.json() so the
// ECDSA signature is verified over the raw body bytes Circle signed.
app.use(circleWebhookRouter);
// F-004 — Zero Hash fiat webhook. Also raw-body mounted (HMAC over bytes).
app.use(fiatWebhookRouter);
app.use(express.json());
app.use(ipRateLimiter);
app.use(killSwitch);
app.use(attachAuth);

app.use(healthRouter);
// Phase 7 — the platform status (R-005) and the live market stream (R-001).
app.use(platformStatusRouter);
app.use(liveStreamRouter);
app.use(rpcProxyRouter);
app.use(poolsRouter);
app.use(poolCreateRouter);
app.use(poolStateRouter);
app.use(liquidityAddRouter);
app.use(liquidityRemoveRouter);
// B7-006 — pool↔market linkage for the pool list's market-status column.
app.use(marketPoolsRouter);
// 038 / S-010 — Mantua's own per-market metrics snapshot (authless read).
app.use(marketMetricsRouter);
app.use(positionsRouter);
app.use(earningsRouter);
app.use(portfolioRouter);
app.use(quoteRouter);
app.use(swapRouter);
app.use(tokenPricesRouter);
app.use(pairPriceChartRouter);
app.use(v4SwapRouter);
app.use(fiatRailsRouter);
app.use(agentWalletsRouter);
app.use(agentPolicyRouter);
app.use(agentPerformanceRouter);
app.use(agentSendRouter);
app.use(agentSwapRouter);
app.use(agentLiquidityRouter);
app.use(agentQueryRouter);
app.use(agentPortfolioRouter);
app.use(agentUnifiedBalanceRouter);
app.use(cronRebalanceRouter);
app.use(cronPegSyncRouter);
app.use(cronSportsSyncRouter);
app.use(cronLiveSyncRouter);
app.use(adminSpPoolRouter);
app.use(sportsSlateRouter);
app.use(strategiesRouter);
app.use(marketTradeRouter);
app.use(marketPositionsRouter);
app.use(marketFillsRouter);
app.use(marketDetailRouter);
// Task 050 — id-free discover read (slate + liquidity + popularity).
app.use(marketDiscoverRouter);
app.use(marketDepthRouter);
app.use(marketAnalysisRouter);
app.use(marketHistoryRouter);
// Task 069 (V-001) — the single-use token the browser transcribes with.
app.use(voiceTokenRouter);
// Task 071 (MX-004) — Web Push subscriptions.
app.use(pushRouter);
// Task 067 (G-014) — recorded Terms acceptance.
app.use(legalRouter);
app.use(cspReportRouter);
app.use(marketRedeemRouter);
app.use(activityRouter);
app.use(portfolioEconomicsRouter);
app.use(cronStrategiesRouter);
app.use(cronResolutionRouter);
// Task 072 (Phase 16) — combo tickets: builder reads, the single-transaction
// trade path, and the fifteen-minute monitor tick.
app.use(combosRouter);
app.use(combosTradeRouter);
app.use(cronCombosRouter);
app.use(resolutionOpsRouter);
// Phase 7 / R-010 — operator metrics + alerts (cron-secret guarded).
app.use(opsMetricsRouter);
app.use(cronIntentsRouter);
app.use(x402ServiceRouter);
// Phase 17 (MP-007) — the paid trading services; kill-switch covered by
// virtue of running after app.use(killSwitch) above.
app.use(x402TradingRouter);
// Phase 17 (MP-005/006) — the paid discovery and intelligence reads.
app.use(x402DiscoveryRouter);
app.use(x402IntelligenceRouter);
app.use(agentChatRouter);
app.use(agentInstructionRouter);
app.use(commandParseRouter);
app.use(analyticsRouter);
app.use(analyzeRouter);
app.use(analyzeChatRouter);
app.use(agentSocialRouter);
app.use(agentsPublicRouter);
app.use(cronSocialPostsRouter);
app.use(supportChatRouter);
