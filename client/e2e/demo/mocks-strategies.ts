/**
 * The hedging-strategy routes for the demo's "manage" shot, with the same
 * two-step shape the server uses (`server/src/routes/strategies.ts`): a
 * natural-language text previews as a draft plus the markets it could
 * attach to, and nothing arms until the user confirms. State is in memory
 * for the length of one recording.
 */
import type { Page, Route } from "@playwright/test";
import type { DemoEvent } from "./snapshot.ts";
import { featuredGame } from "./turns-analyze.ts";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

interface StrategyRow {
  id: string;
  strategyType: string;
  status: "armed" | "triggered" | "executed" | "expired" | "disarmed";
  config: Record<string, unknown>;
  capUsd: string;
  disarmedReason: string | null;
  armedAt: string;
}

/** The team the demo arms a take-profit on: the favourite's opponent in the featured game. */
export function strategyTarget(events: readonly DemoEvent[]): {
  team: DemoEvent["home"];
  opponent: DemoEvent["home"];
  text: string;
} {
  const game = featuredGame(events);
  const home = game?.home ?? { key: "nfl:DET", name: "Detroit Lions", abbreviation: "DET" };
  const away = game?.away ?? { key: "nfl:ARI", name: "Arizona Cardinals", abbreviation: "ARI" };
  const homeFavoured = (game?.homeWinProbabilityBps ?? 5000) >= 5000;
  const team = homeFavoured ? home : away;
  const opponent = homeFavoured ? away : home;
  const nickname = team.name.split(" ").at(-1) ?? team.name;
  return { team, opponent, text: `take profit at 80% on the ${nickname}` };
}

/** Mirrors `previewLines` for a take-profit draft (server/src/lib/sports/strategy-parse.ts). */
function previewLines(teamQuery: string): string[] {
  return [
    "Type: take-profit / stop on one market position",
    `Market: "${teamQuery}" (to be confirmed)`,
    "Close at profit: implied probability ≥ 80%",
    "Spend cap: $100 USDC",
    "Stays armed through the game. Auto-disarms when the market closes (final game, " +
      "or 12h after kickoff), on resolution, or at expiry. Nothing arms until you confirm.",
  ];
}

export async function installStrategyRoutes(
  page: Page,
  events: readonly DemoEvent[],
  nowMs: number,
): Promise<void> {
  const target = strategyTarget(events);
  const marketId = `0x${"5a".repeat(32)}`;
  const rows: StrategyRow[] = [];
  await page.route("**/api/strategies**", (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === "GET") return json(route, { strategies: rows });
    if (url.pathname.endsWith("/preview")) {
      const nickname = target.team.name.split(" ").at(-1) ?? target.team.name;
      return json(route, {
        draft: { kind: "take-profit-stop", teamQuery: nickname, takeProfitBps: 8000, capUsd: 100 },
        preview: previewLines(nickname),
        candidates: [
          {
            marketId,
            side: "yes",
            label: `${target.team.name} to beat ${target.opponent.name}`,
            league: "nfl",
          },
        ],
      });
    }
    if (url.pathname.endsWith("/disarm")) {
      const row = rows.find((r) => url.pathname.includes(r.id));
      if (row) {
        row.status = "disarmed";
        row.disarmedReason = "user";
      }
      return json(route, { strategy: row ?? null });
    }
    const row: StrategyRow = {
      id: "demo-strategy-1",
      strategyType: "take_profit",
      status: "armed",
      config: { marketId, side: "yes", takeProfitBps: 8000 },
      capUsd: "100.00",
      disarmedReason: null,
      armedAt: new Date(nowMs).toISOString(),
    };
    rows.push(row);
    return json(route, { strategy: row }, 201);
  });
}
