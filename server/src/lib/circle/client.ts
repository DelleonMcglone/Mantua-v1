import type * as DCW from "@circle-fin/developer-controlled-wallets";
import { env } from "../../env.ts";
import { logger } from "../logger.ts";

// The SDK is loaded via a LAZY dynamic `import()` (not a top-level import, and
// not the old `createRequire` require) for two reasons:
//   1. Tracing — the esbuild bundle for Vercel keeps a string-literal
//      `import("@circle-fin/...")` intact, which the platform's file tracer
//      (@vercel/nft) follows to ship the SDK *and its transitive deps* into the
//      function. A `createRequire(url)` require uses a variable specifier the
//      tracer can't follow, so the package was missing at runtime.
//   2. Boot safety — deferring the load means the server (and every non-Circle
//      route) boots even if the SDK or its creds are absent; only an actual
//      agent-wallet call touches it.
// The CJS factory is exposed as a named export on the dynamic-import namespace
// on Node (`m.initiateDeveloperControlledWalletsClient`), so the type-only
// `DCW` import lines up with the runtime shape.
let dcwModulePromise: Promise<typeof DCW> | null = null;
function loadDcw(): Promise<typeof DCW> {
  dcwModulePromise ??= import("@circle-fin/developer-controlled-wallets");
  return dcwModulePromise;
}

type CircleClient = ReturnType<typeof DCW.initiateDeveloperControlledWalletsClient>;

let cached: CircleClient | null = null;
let cachedWalletSetId: string | null = null;

export class CircleUnavailableError extends Error {
  constructor() {
    super(
      "Circle credentials not configured. Required env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET (a registered entity secret from the Circle Developer Console).",
    );
    this.name = "CircleUnavailableError";
  }
}

/**
 * Lazy singleton for the Circle Developer-Controlled Wallets SDK — the
 * agent-wallet provider on Base. Mirrors the old `getCdpClient()`: the server
 * boots without Circle creds (they're `.optional()` in env.ts) and the first
 * call either constructs the client or throws `CircleUnavailableError`, which
 * routes catch and surface as 503 so the rest of the API stays up.
 */
export async function getCircleClient(): Promise<CircleClient> {
  if (cached) return cached;
  const { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET } = env;
  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) {
    throw new CircleUnavailableError();
  }
  const dcw = await loadDcw();
  cached = dcw.initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY,
    entitySecret: CIRCLE_ENTITY_SECRET,
  });
  return cached;
}

/**
 * The wallet set agent wallets are created in — always `CIRCLE_WALLET_SET_ID`
 * in production.
 *
 * The on-the-fly fallback below is a DEV convenience only. The cache is
 * process-local, so on serverless every cold start would create a *new*
 * wallet set: users' wallets scatter across orphaned sets, and — because a
 * Gas Station policy is bound to a specific set — those wallets are
 * unsponsored and fail with no clear reason. Production refuses rather than
 * silently doing that (boot-time validation in env.ts catches it earlier;
 * this is the second line of defence for a runtime env mutation).
 */
export async function getAgentWalletSetId(): Promise<string> {
  if (env.CIRCLE_WALLET_SET_ID) return env.CIRCLE_WALLET_SET_ID;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "CIRCLE_WALLET_SET_ID is not set. Refusing to create a wallet set implicitly in production — a per-cold-start set would leave agent wallets outside the Gas Station policy. Create one wallet set, pin its id in env, and redeploy.",
    );
  }
  if (cachedWalletSetId) return cachedWalletSetId;
  const res = await (await getCircleClient()).createWalletSet({ name: "Mantua Agent Wallets" });
  const id = res.data?.walletSet.id;
  if (!id) throw new Error("Circle createWalletSet returned no wallet set id");
  cachedWalletSetId = id;
  logger.warn(
    { walletSetId: id },
    "Created a Circle wallet set on the fly — set CIRCLE_WALLET_SET_ID in env to reuse it across restarts.",
  );
  return id;
}

/** Test-only escape hatch — inject a fake client (or null to reset). */
export function setCircleClientForTesting(client: CircleClient | null): void {
  cached = client;
}
