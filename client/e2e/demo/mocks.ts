/**
 * The demo's own API answers, on top of the e2e harness: today's slate, the
 * agent wallet, the user's agent policy and track record, and the profile
 * reads the harness's `**\/api/portfolio**` catch-all would otherwise
 * swallow. Shapes mirror the server's (`server/src/lib/agent/policy.ts`,
 * `performance.ts`, `routes/portfolio-economics.ts`, `routes/activity.ts`).
 */
import type { Page, Route } from "@playwright/test";
import { installStrategyRoutes } from "./mocks-strategies.ts";
import type { DemoSlate } from "./slate.ts";
import type { DemoEvent } from "./snapshot.ts";

export const AGENT_ADDRESS = "0x0eea000000000000000000000000000000009c03";
export const DAILY_CAP_USD = 500;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const agentPortfolio = () => ({
  address: AGENT_ADDRESS,
  balances: [{ symbol: "USDC", balanceRaw: "250000000", decimals: 6, usdValue: 250 }],
  transactions: [],
  positions: [],
});

/** `AgentPolicyView`: the limits the Profile → Agent tab shows and edits. */
const policy = (nowMs: number) => ({
  status: "active",
  autoTradeEnabled: false,
  maxStakePerTradeUsd: 100,
  riskLevel: "balanced",
  allowedLeagues: ["nfl"],
  hedge: {
    maxSizeUsd: 50,
    maxExposureUsd: 200,
    minConfidenceBps: 0,
    cooldownMinutes: 0,
    dailyBudgetUsd: 100,
    allowedMarketTypes: [],
  },
  combo: {
    enabled: true,
    maxLegs: 3,
    maxStakeUsd: 25,
    maxOpenExposureUsd: 100,
    maxPayoutUsd: 1000,
    takeProfitBps: 8000,
    autoManage: false,
  },
  updatedAt: new Date(nowMs - 3 * 86_400_000).toISOString(),
  persisted: true,
});

const totals = {
  resolvedMarkets: 0,
  wins: 0,
  losses: 0,
  voided: 0,
  winRate: null,
  realizedPnlUsd: 0,
  openCostUsd: 0,
  openMarkets: 0,
  trades: 0,
  returnOnResolvedCost: null,
  bySource: { agent_chat: 0, hedge_strategy: 0, user: 0 },
  lpCollectedUsd: null,
};

const economics = () => ({
  lp: [],
  lpTotals: {
    positions: 0,
    currentValueUsd: 0,
    accruedFeesUsd: 0,
    depositedUsd: 0,
    pnlUsd: 0,
    withoutBasis: 0,
  },
  realized: { marketRealizedPnlUsd: 0, marketWinRate: null, resolvedMarkets: 0, openCostUsd: 0 },
});

export interface DemoData {
  slate: DemoSlate;
  events: readonly DemoEvent[];
  nowMs: number;
}

/** Register after `mockApi`: Playwright serves the last matching route first. */
export async function installDemoRoutes(page: Page, data: DemoData): Promise<void> {
  await page.route("**/api/sports/slate**", (route) => json(route, data.slate));
  await page.route("**/api/agent/portfolio**", (route) => json(route, agentPortfolio()));
  await page.route("**/api/agent/policy**", (route) => {
    const patch =
      route.request().method() === "PATCH"
        ? (route.request().postDataJSON() as Record<string, unknown>)
        : {};
    return json(route, { ...policy(data.nowMs), ...patch });
  });
  await page.route("**/api/agent/performance**", (route) =>
    json(route, { address: AGENT_ADDRESS, markets: [], totals }),
  );
  await page.route("**/api/activity**", (route) => json(route, { items: [], nextBefore: null }));
  await page.route("**/api/portfolio/economics**", (route) => json(route, economics()));
  await page.route("**/api/portfolio/settled**", (route) =>
    json(route, {
      rows: [],
      totals: { wins: 0, losses: 0, voided: 0, realizedPnlUsd: 0, winRate: null },
    }),
  );
  await installStrategyRoutes(page, data.events, data.nowMs);
}
