import { expect, test } from "@playwright/test";
import { launchApp, mockApi, signIn } from "./harness.ts";

/**
 * A research turn in the agent (owner, 2026-10-03, mirroring Coinbase for
 * Agents): the status line, one source pill per data read with its cost,
 * findings between them, and the Summary card with ratings and the budget.
 * The agent stream is scripted; nothing reaches a model.
 */
const frames = [
  { type: "session", sessionId: "s1" },
  {
    type: "text",
    delta:
      "Researching the Browns game with Mantua's schedule, injury and market data — free, plus one paid data call. ",
  },
  { type: "tool_start", id: "t1", tool: "get_player_injury_status", args: {} },
  {
    type: "tool_result",
    id: "t1",
    tool: "get_player_injury_status",
    ok: true,
    data: { injuries: [] },
  },
  { type: "text", delta: "No Browns starters are listed as out. " },
  { type: "tool_start", id: "t2", tool: "call_paid_service", args: {} },
  {
    type: "tool_result",
    id: "t2",
    tool: "call_paid_service",
    ok: true,
    data: { available: true, provider: "Exa", service: "https://api.exa.ai/search", usdCost: 0.01 },
  },
  { type: "tool_start", id: "t3", tool: "mantua_compare_markets", args: {} },
  {
    type: "tool_result",
    id: "t3",
    tool: "mantua_compare_markets",
    ok: true,
    data: {
      status: "ok",
      budgetUsdc: 100,
      rows: [
        {
          game: "Pittsburgh Steelers at Cleveland Browns",
          team: "Cleveland Browns",
          priceBps: 5500,
          moveTodayPoints: 3.5,
          rating: "Lean YES",
          rationale: "record: 7-3 vs 4-6",
        },
        {
          game: "Kansas City Chiefs at Las Vegas Raiders",
          team: "Las Vegas Raiders",
          priceBps: 3100,
          moveTodayPoints: -1.2,
          rating: "Thin",
          rationale: "liquidity: 12 USDC in the pool",
        },
      ],
    },
  },
  {
    type: "text",
    delta:
      "How would you like to put $100 to work? I can place it from your agent wallet — tell me the split.",
  },
  { type: "done" },
];

test("a research turn shows source pills with costs and the Summary card", async ({ page }) => {
  await mockApi(page, { termsAccepted: true });
  await page.route("**/api/agent/portfolio**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        address: "0x0eea000000000000000000000000000000009c03",
        balances: [],
        transactions: [],
        positions: [],
      }),
    }),
  );
  await page.route("**/api/agent/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(""),
    }),
  );
  await launchApp(page);
  await signIn(page);
  await page.getByText("Create / Manage Sports Agent").first().click();
  // Any complete prompt sends; the scripted stream plays the research turn.
  await page.getByTestId("agent-starter-prompt").first().click();

  const pills = page.getByTestId("source-pill");
  await expect(pills).toHaveCount(2);
  await expect(pills.nth(0)).toContainText("Mantua");
  await expect(pills.nth(0)).toContainText("injuries");
  await expect(pills.nth(0)).toContainText("free");
  await expect(pills.nth(1)).toContainText("Exa");
  await expect(pills.nth(1)).toContainText("0.01 USDC");

  const card = page.getByTestId("summary-card");
  await expect(card).toContainText("Summary · $100.00 to put to work");
  await expect(card).toContainText("Cleveland Browns");
  await expect(card).toContainText("55¢");
  await expect(card).toContainText("+3.5 pts today");
  await expect(card).toContainText("Lean YES");
  await expect(card).toContainText("Thin");
  await expect(page.getByText(/put \$100 to work\?/)).toBeVisible();
  await page.screenshot({ path: "test-results/agent-research.png", fullPage: true });
});
