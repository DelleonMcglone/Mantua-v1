/**
 * Records the walkthrough's three shots as webm clips (see README.md):
 *
 *   npx tsx e2e/demo/record.ts [board|analyze|agent]   # needs the shimmed Vite server on 5173
 *
 * The app is the real client; every API answer is scripted (`mocks.ts`),
 * today's games come from the owner's ESPN snapshot when present
 * (`snapshot.ts`), and the two chat streams are served frame by frame over
 * a local SSE server. Output: e2e/demo/out/{board,analyze,agent}.webm with
 * a `.json` sidecar carrying each clip's cut-in point.
 */
import { demoData } from "./browser.ts";
import { recordAgent } from "./clip-agent.ts";
import { recordAnalyze } from "./clip-analyze.ts";
import { recordBoard } from "./clip-board.ts";
import { sundayEvents } from "./clock.ts";

const data = demoData();
const today = sundayEvents(data.events);
console.log(
  `slate: ${data.source} — ${String(today.length)} games on the demo day, ` +
    `clock pinned to ${new Date(data.nowMs).toISOString()}`,
);
if (data.source === "fallback") {
  console.warn("SNAPSHOT ABSENT — showing the Oct 4 schedule: no scores, every game scheduled.");
}

const only = process.argv[2];
if (!only || only === "board") await recordBoard(data);
if (!only || only === "analyze") await recordAnalyze(data);
if (!only || only === "agent") await recordAgent(data);
