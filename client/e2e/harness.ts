import type { Page, Route } from "@playwright/test";
import { TERMS_VERSION, discover, livePrices, portfolio, slate, status } from "./fixtures.ts";
import { calldata, quote } from "./fixtures-trade.ts";
import {
  analysisRead,
  depthRead,
  historyRows,
} from "../src/features/markets/detail/depth-fixtures.ts";
import { respond } from "./rpc-mock.ts";

/**
 * Task 067 (G-001) — installs the scripted API and chain on a page.
 * `mockApi` answers every route the app can ask for from `fixtures.ts`;
 * each option flips one server condition so a spec can drive an error
 * path. `signIn` and `launchApp` are the two steps every journey shares.
 */
export interface MockOptions {
  /** Trade quote answers with this server error instead of a quote. */
  quoteError?: { status: number; code: string; error: string };
  /** Platform paused (kill switch). */
  paused?: boolean;
  /** The user already accepted the current Terms. */
  termsAccepted?: boolean;
  /** The Chiefs game is in progress: live score, plays, in-game prices. */
  liveGame?: boolean;
}

interface TradeBody {
  amountRaw: string;
  direction: "buy" | "sell";
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Install every API answer the app can ask for on this page. */
export async function mockApi(
  page: Page,
  opts: MockOptions = {},
): Promise<{ state: { termsAccepted: boolean; fills: number } }> {
  const state = { termsAccepted: Boolean(opts.termsAccepted), fills: 0 };
  const acceptance = () => ({
    version: TERMS_VERSION,
    acceptedVersion: state.termsAccepted ? TERMS_VERSION : null,
    acceptedAt: state.termsAccepted ? new Date().toISOString() : null,
    current: state.termsAccepted,
  });

  // Last registered wins, so the catch-all goes first.
  await page.route("**/api/**", (route) =>
    json(route, { error: "e2e: not mocked", code: "NOT_MOCKED" }, 404),
  );
  await page.route("**/api/status", (route) => json(route, status(opts.paused)));
  await page.route("**/api/stream/live**", (route) => route.abort());
  await page.route("**/api/sports/slate**", (route) => json(route, slate(opts.liveGame)));
  await page.route("**/api/markets/discover**", (route) => json(route, discover()));
  await page.route("**/api/markets/positions**", (route) => json(route, { positions: [] }));
  await page.route("**/api/markets/detail**", (route) =>
    json(route, {
      hasMarkets: true,
      prices: opts.liveGame ? livePrices() : [],
      activity: [],
      holders: [],
    }),
  );
  await page.route("**/api/markets/comments**", (route) => json(route, { comments: [] }));
  await page.route("**/api/markets/depth**", (route) =>
    json(route, depthRead({ live: Boolean(opts.liveGame) })),
  );
  await page.route("**/api/markets/analysis**", (route) => {
    const side = new URL(route.request().url()).searchParams.get("outcomeIndex") === "1" ? 1 : 0;
    return json(route, analysisRead(side));
  });
  await page.route("**/api/markets/history**", (route) => json(route, historyRows()));
  await page.route("**/api/portfolio**", (route) => json(route, portfolio()));
  await page.route("**/api/legal/acceptance", (route) => {
    if (route.request().method() === "POST") {
      state.termsAccepted = true;
      return json(route, { ok: true, doc: "terms", version: TERMS_VERSION }, 201);
    }
    return json(route, { terms: acceptance(), privacy: acceptance() });
  });
  await page.route("**/api/markets/trade/quote", (route) => {
    if (opts.quoteError)
      return json(
        route,
        { error: opts.quoteError.error, code: opts.quoteError.code },
        opts.quoteError.status,
      );
    const body = route.request().postDataJSON() as TradeBody;
    return json(route, quote(body.amountRaw, body.direction));
  });
  await page.route("**/api/markets/trade/calldata", (route) => {
    const body = route.request().postDataJSON() as TradeBody;
    return json(route, calldata(body.amountRaw, body.direction));
  });
  await page.route("**/api/markets/trade/status**", (route) =>
    json(route, { state: "confirmed", recorded: true }),
  );
  await page.route("**/api/markets/fills", (route) => {
    state.fills += 1;
    return json(route, { ok: true }, 201);
  });
  await page.route("**/__e2e/rpc", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: respond(route.request().postData() ?? "{}"),
    }),
  );
  return { state };
}

/** Sign the shimmed session in (see privy-shim.tsx). */
export async function signIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__mantuaE2E?.login();
  });
}

/** From the landing page into the app shell's home. */
export async function launchApp(page: Page): Promise<void> {
  await page.goto("/");
  await page
    .getByRole("button", { name: /launch app/i })
    .first()
    .click();
}

declare global {
  interface Window {
    __mantuaE2E?: { login: () => void; logout: () => void };
  }
}
