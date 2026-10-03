import { expect, test } from "@playwright/test";
import { launchApp, mockApi } from "./harness.ts";

/**
 * The logged-out analyst shows the same source pills as the agent, with
 * its findings in arrival order (owner, 2026-10-03). The stream is scripted.
 */
const frames = [
  { type: "text", delta: "Checking the schedule first. " },
  { type: "tool_start", id: "a1", tool: "get_nfl_schedule", args: {} },
  { type: "tool_result", id: "a1", tool: "get_nfl_schedule", ok: true, data: { games: [] } },
  { type: "text", delta: "The Browns and Steelers meet again on 1 November." },
  { type: "done" },
];

test("the analyst shows source pills between its findings", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/analyze/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(""),
    }),
  );
  await launchApp(page);
  const dock = page.getByRole("textbox", { name: /ask mantua/i });
  await dock.fill("do the Browns and Steelers play again?");
  await dock.press("Enter");

  const pill = page.getByTestId("source-pill");
  await expect(pill).toHaveCount(1);
  await expect(pill).toContainText("Mantua");
  await expect(pill).toContainText("schedule");
  await expect(pill).toContainText("free");
  await expect(page.getByText("meet again on 1 November")).toBeVisible();
  // Reading order: the opening line sits above the pill, the finding below it.
  const y = async (text: string | RegExp) =>
    (await page.getByText(text).first().boundingBox())?.y ?? Number.NaN;
  const pillY = (await pill.boundingBox())?.y ?? Number.NaN;
  expect(await y("Checking the schedule first.")).toBeLessThan(pillY);
  expect(pillY).toBeLessThan(await y(/meet again/));
});
