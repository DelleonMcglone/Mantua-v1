import { expect, test } from "@playwright/test";
import { launchApp, signIn } from "../harness.ts";
import { mockMobileApi } from "./fixtures-mobile.ts";
import { TOUCH_TARGET_PX } from "../../src/lib/mobile.ts";

/**
 * The agent's new cards on a phone: source pills, the Summary card and the
 * basket preview fit the viewport with no horizontal overflow, and Approve
 * is a touch target. The stream is scripted.
 */
const frames = [
  { type: "session", sessionId: "s1" },
  { type: "text", delta: "Researching with Mantua's data — free. " },
  { type: "tool_start", id: "t1", tool: "get_player_injury_status", args: {} },
  { type: "tool_result", id: "t1", tool: "get_player_injury_status", ok: true, data: {} },
  { type: "tool_start", id: "t2", tool: "call_paid_service", args: {} },
  {
    type: "tool_result",
    id: "t2",
    tool: "call_paid_service",
    ok: true,
    data: {
      available: true,
      provider: "Dripstack",
      service: "https://dripstack.io/x",
      usdCost: 0.02,
    },
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
          rationale:
            "record: 7-3 vs 4-6, a long rationale line that must wrap rather than overflow the phone",
        },
      ],
    },
  },
  { type: "tool_start", id: "t4", tool: "mantua_simulate_basket", args: {} },
  {
    type: "tool_result",
    id: "t4",
    tool: "mantua_simulate_basket",
    ok: true,
    data: {
      executable: true,
      totalUsdc: 100,
      budgetUsdc: 100,
      legs: [
        {
          label: "Cleveland Browns YES",
          providerEventId: "401",
          outcomeIndex: 0,
          amountUsdc: 60,
          executable: true,
          blockers: [],
          contracts: 109.09,
          effectivePriceBps: 5500,
        },
        {
          label: "Las Vegas Raiders YES",
          providerEventId: "402",
          outcomeIndex: 1,
          amountUsdc: 40,
          executable: true,
          blockers: [],
          contracts: 129.03,
          effectivePriceBps: 3100,
        },
      ],
    },
  },
  { type: "done" },
];

test("source pills, the Summary card and the basket preview fit a phone", async ({ page }) => {
  await mockMobileApi(page, { termsAccepted: true });
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
  await page.getByTestId("agent-starter-prompt").first().click();

  await expect(page.getByTestId("source-pill")).toHaveCount(2);
  await expect(page.getByTestId("summary-card")).toContainText("Lean YES");
  await expect(page.getByTestId("basket-preview")).toContainText("Order preview");
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  const box = await approve.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  await page.screenshot({
    path: `test-results/agent-cards-${test.info().project.name}.png`,
    fullPage: true,
  });
});
