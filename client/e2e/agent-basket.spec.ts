import { expect, test } from "@playwright/test";
import { launchApp, mockApi, signIn } from "./harness.ts";

/**
 * The basket (owner, 2026-10-03, Coinbase for Agents items 7–9): the user's
 * split becomes an Order preview card with an Approve button; Approve sends
 * the user's own "confirm" (the only consent the server accepts); the fills
 * come back as the same card with every row marked and the totals line.
 * Both agent turns are scripted; nothing reaches a model or a chain.
 */
const previewTurn = [
  { type: "session", sessionId: "s1" },
  {
    type: "text",
    delta: "Here is the basket as you asked — approve it and I will place both legs. ",
  },
  { type: "tool_start", id: "t1", tool: "mantua_simulate_basket", args: {} },
  {
    type: "tool_result",
    id: "t1",
    tool: "mantua_simulate_basket",
    ok: true,
    data: {
      executable: true,
      totalUsdc: 100,
      budgetUsdc: 100,
      legs: [
        {
          label: "Browns YES",
          providerEventId: "401",
          outcomeIndex: 0,
          amountUsdc: 60,
          executable: true,
          blockers: [],
          contracts: 109.09,
          effectivePriceBps: 5500,
        },
        {
          label: "Raiders YES",
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
const fillTurn = [
  { type: "session", sessionId: "s1" },
  { type: "tool_start", id: "t2", tool: "mantua_execute_basket", args: { budgetUsdc: 100 } },
  {
    type: "tool_result",
    id: "t2",
    tool: "mantua_execute_basket",
    ok: true,
    data: {
      placedUsdc: 96.4,
      requestedUsdc: 100,
      leftoverUsdc: 3.6,
      filled: 1,
      failed: 1,
      legs: [
        {
          label: "Browns YES",
          providerEventId: "401",
          outcomeIndex: 0,
          amountUsdc: 60,
          status: "filled",
          received: "109.09 YES",
          effectivePriceBps: 5500,
          error: null,
        },
        {
          label: "Raiders YES",
          providerEventId: "402",
          outcomeIndex: 1,
          amountUsdc: 40,
          status: "failed",
          received: null,
          effectivePriceBps: null,
          error: "pool is thin",
        },
      ],
    },
  },
  {
    type: "text",
    delta:
      "One of two legs filled; the Raiders leg failed because the pool is thin, so $40 stayed in your wallet.",
  },
  { type: "done" },
];

test("a split becomes an Order preview with Approve, and Approve places the basket", async ({
  page,
}) => {
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
  const sent: string[] = [];
  await page.route("**/api/agent/chat", async (route) => {
    const body = route.request().postDataJSON() as { message: string };
    sent.push(body.message);
    const frames = body.message === "confirm" ? fillTurn : previewTurn;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(""),
    });
  });
  await launchApp(page);
  await signIn(page);
  await page.getByText("Create / Manage Sports Agent").first().click();
  await page.getByTestId("agent-starter-prompt").nth(3).click();

  const preview = page.getByTestId("basket-preview");
  await expect(preview).toContainText("Order preview · $100.00 basket");
  await expect(preview).toContainText("Browns YES");
  await expect(preview).toContainText("109.09 ct");
  await expect(preview).toContainText("@ 55¢");
  await page.screenshot({ path: "test-results/agent-basket-preview.png", fullPage: true });

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  expect(sent.at(-1)).toBe("confirm");

  // The earlier preview keeps its rows but no longer offers Approve.
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  const fills = page.getByTestId("basket-fills");
  await expect(fills).toContainText("Filled");
  await expect(fills).toContainText("Failed");
  await expect(fills).toContainText("1 of 2 legs filled");
  await expect(fills).toContainText("$96.40");
  await expect(fills).toContainText("$3.60");
  await expect(fills).toContainText("pool is thin");
  await page.screenshot({ path: "test-results/agent-basket-fills.png", fullPage: true });
});
