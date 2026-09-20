import { z } from "zod";
import { rpcProviderIssues } from "./lib/rpc-config.ts";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.url(),

  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),

  UNISWAP_TRADING_API_KEY: z.string().min(1).optional(),

  // ── Fiat rails (D-101) ───────────────────────────────────────────────
  // Zero Hash is the regulated on/off-ramp of record.  It owns KYC/AML,
  // custody during conversion, ACH/RTP movement, and transaction monitoring.
  // Until commercial credentials are provisioned we only expose the local
  // deterministic sandbox; production defaults to disabled.
  FIAT_RAILS_MODE: z.enum(["disabled", "sandbox", "live"]).default("disabled"),
  ZERO_HASH_API_KEY: z.string().min(1).optional(),
  ZERO_HASH_PASSPHRASE: z.string().min(1).optional(),
  ZERO_HASH_SECRET: z.string().min(1).optional(),
  ZERO_HASH_PLATFORM_CODE: z.string().min(1).optional(),
  /** Zero Hash environment: `sandbox` targets the cert host
   *  (api.cert.zerohash.com), `production` the live API. Independent of
   *  FIAT_RAILS_MODE so `sandbox` mode can exercise real cert credentials. */
  ZERO_HASH_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  /** HMAC secret for Zero Hash webhook deliveries (x-zh-hook-signature).
   *  Absent → POST /api/fiat/webhook fails closed (503) — an unverified
   *  provider event is never processed. */
  ZERO_HASH_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** D-112 — the USDC destination network for fiat deposits is CONFIG, not
   *  code. Zero Hash asset codes are `USDC.<NETWORK>`; this names the
   *  network half. Whether Zero Hash can deliver USDC on Arc is an OPEN
   *  question tracked in D-112 — if the launch chain moves, this variable
   *  (plus Zero Hash-side asset support) is the entire switch. */
  FIAT_USDC_NETWORK: z.string().min(1).default("BASE"),
  PLAID_CLIENT_ID: z.string().min(1).optional(),
  PLAID_SECRET: z.string().min(1).optional(),
  PLAID_ENV: z.enum(["sandbox", "development", "production"]).default("sandbox"),
  /** Zero Hash's Plaid processor id, issued during commercial onboarding. */
  ZERO_HASH_PLAID_PROCESSOR_ID: z.string().min(1).optional(),

  /** Network gate. Mantua runs on Base Mainnet — defaults to `mainnet`;
   *  the `testnet` option is retained for the shared IS_MAINNET guard. */
  MANTUA_NETWORK: z.enum(["mainnet", "testnet"]).default("mainnet"),

  /** Base Mainnet RPC URL — used by all server-side viem reads and the
   *  wallet-side proxy. Phase 7 / R-006: production MUST point this at a
   *  dedicated endpoint (Alchemy / QuickNode / paid dRPC …); a public,
   *  rate-limited host fails the production boot (`rpcProviderIssues` in
   *  lib/rpc-client.ts). The default is a dev convenience only. */
  BASE_RPC_URL: z.url().default("https://mainnet.base.org"),
  /** Additional DEDICATED endpoints, comma-separated, tried in order after
   *  the primary (viem `fallback`). Public hosts here are a config error. */
  BASE_RPC_FALLBACK_URLS: z.string().min(1).optional(),
  /** Append the public hosts as a last-resort backstop. Unset → on outside
   *  production, off in production. `1` in production fails the boot. */
  BASE_RPC_PUBLIC_FALLBACK: z.union([z.literal("0"), z.literal("1")]).optional(),

  // ── Postgres pool (Phase 7 / R-002) — per lambda instance ────────────
  /** Connections per instance. Small on purpose: the real ceiling is this
   *  × live instances against the pooler. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  /** Max wait for a pool slot before failing the query (ms). */
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
  /** Max runtime for one statement (ms) — a runaway query fails, never
   *  holds the lambda to its 300 s ceiling. */
  DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),

  /** The Graph decentralized-network API key. Required for /api/positions
   *  to surface pre-Mantua v4 positions; absence degrades gracefully (only
   *  Mantua-opened positions are returned). */
  THE_GRAPH_API_KEY: z.string().min(1).optional(),
  UNISWAP_V4_BASE_SUBGRAPH_ID: z
    .string()
    .min(1)
    .default("HNCFA9TyBqpo5qpe6QreQABAA1kV8g46mhkCcicu6v2R"),

  // ── Circle credentials ───────────────────────────────────────────────
  // Provisioned by hand in the Circle Developer Console — see
  // docs/tasks/018-circle-credentials.md for the runbook. Never hardcode
  // these; the entity secret is full custody of every agent wallet.
  //
  // All optional so the server boots without them (agent routes 503);
  // `circleCredentialIssues()` below upgrades the important ones to hard
  // failures in production.

  /** Console API key, `PREFIX:ID:SECRET`. `LIVE_API_KEY:…` for mainnet;
   *  a `TEST_API_KEY:…` here means the agent is pointed at testnet. */
  CIRCLE_API_KEY: z
    .string()
    .min(1)
    // Deliberately NOT shape-validated. The SDK accepts any string and
    // Circle is the only authority on what a valid key looks like; a strict
    // regex here would brick the boot if Circle ever changes the format.
    // We only reject whitespace, which is always a paste error. The
    // 3-part shape is surfaced as advice by `circle:preflight`.
    .refine((v) => !/\s/.test(v), "must not contain whitespace — check for a broken paste")
    .optional(),
  /** Registered 32-byte entity secret, hex (64 chars). Generated and
   *  registered by the operator; Circle never stores it in plain text and
   *  neither do we. Losing it without the recovery file is unrecoverable. */
  CIRCLE_ENTITY_SECRET: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "expected 64 hex chars (32 bytes)")
    .optional(),
  /** The wallet set agent wallets are provisioned into. Pin this: an unset
   *  value makes every serverless cold start mint a NEW wallet set, outside
   *  whatever Gas Station policy is bound to the intended one. */
  CIRCLE_WALLET_SET_ID: z.uuid().optional(),

  /** Gas Station (paymaster) policy id, from Console → Gas Station. Circle
   *  sponsors DCW SCA transactions automatically from the policy that is
   *  ACTIVE and default for the chain — the DCW transaction API has no
   *  sponsorship argument — so consuming this id means: stamping it onto
   *  every transaction as Circle's refId (sponsorship.ts), refusing an
   *  unsponsored create in production, and asserting here (UUID shape; the
   *  issue list below) that sponsorship was configured deliberately rather
   *  than discovering an unsponsored wallet as a mystery timeout. */
  CIRCLE_GAS_STATION_POLICY_ID: z.uuid().optional(),

  /** Local-testing only: point the Circle SDK at a stub server (for
   *  preflight evidence or fixtures). Never set this in production — the
   *  override redirects ALL Circle traffic. */
  CIRCLE_API_BASE_URL: z.url().optional(),
  /** Circle SCA version pinned at wallet creation. Circle's platform default
   *  moves to `circle_6900_singleowner_v4` on 2026-09-14 (new address
   *  derivation, EntryPoint v0.7). Mantua's gateway spends default to "the
   *  agent's own address" on the destination chain, which only holds if a
   *  wallet created later on another chain derives the SAME address — so
   *  creation pins the version explicitly instead of inheriting the
   *  platform default. Keep v3 for the existing wallet set; move to v4 only
   *  with a fresh wallet set. Runbook §11. */
  CIRCLE_SCA_CORE: z
    .string()
    .regex(/^circle_6900_singleowner_v\d+$/, "expected circle_6900_singleowner_vN")
    .default("circle_6900_singleowner_v3"),

  /** Webhook signature key id for Circle transaction notifications. Circle
   *  recommends webhooks over polling for terminal transaction state; absent
   *  → the poller stays the only completion signal. */
  CIRCLE_WEBHOOK_KEY_ID: z.string().min(1).optional(),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

  /** ElevenLabs key for Scribe v2 Realtime speech-to-text (task 069,
   *  V-001). Server-only: it is exchanged for short-lived single-use
   *  tokens at POST /api/voice/token and never reaches the browser.
   *  Absent → that route answers 503, the microphone is not offered, and
   *  the command interface stays text-only (V-010). */
  ELEVENLABS_API_KEY: z
    .string()
    .min(1)
    .refine((v) => !/\s/.test(v), "must not contain whitespace — check for a broken paste")
    .optional(),

  // ── Task 070 (Phase 13) — social posting and support ────────────────
  /** X (Twitter) API v2 credentials for the deployment's posting account
   *  (D-107): the developer app's consumer key/secret and the account's
   *  access token/secret, signed per OAuth 1.0a on the server. With all
   *  four set, approved posts are sent; with any missing, every post is
   *  recorded as a dry run and nothing leaves the server. Never a login
   *  password: the API cannot be driven by one. */
  X_API_KEY: z.string().min(1).optional(),
  X_API_SECRET: z.string().min(1).optional(),
  X_ACCESS_TOKEN: z.string().min(1).optional(),
  X_ACCESS_TOKEN_SECRET: z.string().min(1).optional(),
  /** The posting account's handle without the @, for the post footer. */
  X_ACCOUNT_HANDLE: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,15}$/)
    .optional(),
  /** The app's public origin, for the performance-page link in posts. */
  PUBLIC_APP_URL: z.url().default("https://mantua.ai"),
  /** Task 072 (Phase 16, CB-010) — platform combo limits, applied to every
   *  user on top of their own policy block. Legs per ticket (≤ 8), the
   *  largest ticket in USDC, how many distinct combo markets the operator
   *  will seed and keep open at once (each one costs COMBO_SEED_USDC of
   *  working float, like MARKET_SEED_USDC for a game market). */
  COMBO_MAX_LEGS: z.coerce.number().int().min(2).max(8).default(6),
  COMBO_MAX_STAKE_USDC: z.coerce.number().positive().max(100_000).default(1_000),
  COMBO_MAX_OPEN_MARKETS: z.coerce.number().int().min(0).max(10_000).default(50),
  COMBO_SEED_USDC: z.coerce.number().int().min(0).max(50_000_000).default(10_000_000),
  /** AE-010 — where an escalation is POSTed (a Slack/Discord/incoming
   *  webhook). Absent → the ticket row and the log line are the signal. */
  SUPPORT_ESCALATION_WEBHOOK_URL: z.url().optional(),

  /** Task 071 (Phase 15, MX-004) — Web Push application keys (RFC 8292
   *  VAPID), base64url: the raw 65-byte P-256 public point and the 32-byte
   *  private scalar, plus the contact the push services may use about a
   *  misbehaving sender. Mint a pair with
   *  `npm run push:generate-keys -w @mantua/server`. Absent → push is off:
   *  the subscribe route answers 503, the client never asks for
   *  notification permission, and nothing is ever sent. */
  VAPID_PUBLIC_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{87}$/, "must be the base64url 65-byte P-256 public key")
    .optional(),
  VAPID_PRIVATE_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, "must be the base64url 32-byte private scalar")
    .optional(),
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, "must be a mailto: or https: contact")
    .optional(),

  MANTUA_KILL_SWITCH: z
    .union([z.literal("0"), z.literal("1")])
    .default("0")
    .transform((v) => v === "1"),
  /** Per-market liquidity seed budget, in USDC units (6dp; 1000000 =
   *  1 USDC). The signer splits into a YES/NO set and LPs the YES/USDC
   *  pool full-range so new markets are tradeable at the opening odds;
   *  actual spend per market lands at ~1–1.4× this figure depending on
   *  the opening price. 0 disables seeding. At 1 USDC a ~$0.50 bet
   *  already exhausted the book, so 2 USDC is the floor for a usable
   *  market; the sweep tops thin pools up to the current target
   *  on every tick, so raising this deepens existing pools too. The
   *  settled-market sweeper (reclaimSettledMarkets) recycles each day's
   *  seed capital back to the signer, so this is working FLOAT (~1–2 days
   *  of slates outstanding), not daily burn. */
  MARKET_SEED_USDC: z.coerce.number().int().min(0).max(50_000_000).default(10_000_000),

  /** B9-007 — strategies-only global kill: every armed hedging strategy
   *  disarms on the next engine tick and nothing new fires. Narrower than
   *  MANTUA_KILL_SWITCH (which blocks all writes app-wide). */
  /** Phase 8 / A-028 — the agent's trading mode, a server setting the model
   *  cannot move: disabled | simulation | user_testing (default, "Always
   *  Ask") | autonomous (future; also needs the user's policy). */
  AGENT_MODE: z
    .enum(["disabled", "simulation", "user_testing", "autonomous"])
    .default("user_testing"),
  STRATEGIES_KILL_SWITCH: z
    .union([z.literal("0"), z.literal("1")])
    .default("0")
    .transform((v) => v === "1"),
  MANTUA_FEE_BPS: z.coerce.number().int().min(0).max(25).default(10),
  MANTUA_FEE_RECIPIENT: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  MANTUA_FEE_ADMIN_KEY: z.string().min(1).optional(),
  /** Task 073 — the operator key behind `/api/ops/*` (institution onboarding).
   *  Sent as `Authorization: Bearer <key>`; absent → those routes are 503. */
  MANTUA_OPS_KEY: z.string().min(16).optional(),

  /** Shared secret guarding the auto-rebalance cron endpoint. Vercel Cron sends
   *  it as `Authorization: Bearer <CRON_SECRET>`; an external scheduler can use
   *  the same header. Absent → the endpoint is disabled (503). */
  CRON_SECRET: z.string().min(1).optional(),
  /** Phase 7 / R-008 — requests carrying `x-mantua-load-test: <this>` skip
   *  the per-IP limiters so a load test from one machine can drive
   *  game-time traffic. Unset → no bypass exists. Rotate after each run. */
  LOAD_TEST_SECRET: z.string().min(16).optional(),

  // ── Shared rate-limit store (C-021) ─────────────────────────────────
  // Upstash Redis REST credentials. With both set, every express-rate-limit
  // counter lives in Redis — shared across lambda instances and immune to
  // recycles. With neither set, limiters fall back to per-instance memory
  // (effective limits multiply by active instances). Provisioning steps:
  // docs/ops/incident-runbook.md §6.
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  /** x402 nanopayments — the agent pays small USDC fees per call to the x402
   *  agent marketplace over plain HTTP (v2 protocol; settles on Base Mainnet
   *  via the public facilitator, no CLI and no gas needed). Off by default;
   *  when off (or no buyer key is configured) the agent falls back to free
   *  data. See docs/x402-setup.md. */
  X402_ENABLED: z
    .union([z.literal("0"), z.literal("1")])
    .default("0")
    .transform((v) => v === "1"),
  /** Buyer EOA private key that signs x402 payment authorizations (needs
   *  Base Mainnet USDC, no gas). Falls back to MANTUA_ADMIN_PRIVATE_KEY —
   *  the same EOA the x402 SELLER is paid to. */
  X402_BUYER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  /** Per-call hard ceiling in USDC. */
  X402_MAX_CALL_USD: z.coerce.number().positive().default(0.1),
  /** Daily x402 spend ceiling in USDC (summed from the audit log). */
  X402_DAILY_CAP_USD: z.coerce.number().positive().default(1),

  // ── Sports data provider (S-001/S-003, D-102) ────────────────────────
  /** Sportradar API key (Console master key, `x-api-key` header auth).
   *  Optional: absent → the licensed adapter is unavailable and the sports
   *  layer falls back to the ESPN prototyping adapter (espn.ts). The key
   *  itself comes from the operator's Sportradar account; contract signature
   *  is operator-side work tracked in D-102. */
  SPORTRADAR_API_KEY: z
    .string()
    .min(1)
    // Like CIRCLE_API_KEY: no shape guess beyond "no whitespace" — Sportradar
    // has changed key lengths before (24 → 40 chars) and is the only
    // authority on the format.
    .refine((v) => !/\s/.test(v), "must not contain whitespace — check for a broken paste")
    .optional(),
  /** Sportradar access level — the URL path segment AND the politeness
   *  profile. `trial` keys are hard-limited to 1 QPS / 1,000 calls per
   *  rolling 30 days, so the adapter stretches its TTLs accordingly. */
  SPORTRADAR_ENV: z.enum(["trial", "production"]).default("trial"),

  /** Pyth Hermes base URL — primary off-chain price source (DefiLlama is the
   *  fallback). Override to point at a self-hosted Hermes; feature is always-on
   *  with graceful fallback, so no separate enable flag. */
  PYTH_HERMES_URL: z.url().default("https://hermes.pyth.network"),

  /** x402 SELLER: address that receives USDC (Base Mainnet) when other agents
   *  pay for Mantua's analyst brief at /api/x402/analyst-brief. Absent → the
   *  seller endpoint is disabled (503). */
  X402_SELLER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),

  /** ERC-8183 AgenticCommerce job/escrow contract. Agent-to-agent commerce
   *  tools (create/fund/settle jobs with USDC escrow) execute against it
   *  from the agent's Circle wallet. Base Mainnet deployment pending — see
   *  docs/tasks/v2-roadmap.md; absent → commerce tools are disabled. */
  AGENTIC_COMMERCE_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),

  /** Mantua hook addresses on Base Mainnet. Deployment pending — see
   *  docs/tasks/v2-roadmap.md; absent → hook-gated pools don't resolve
   *  (graceful degradation). */
  STABLE_PROTECTION_HOOK_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((v) => v as `0x${string}`)
    .optional(),
  DYNAMIC_FEE_HOOK_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((v) => v as `0x${string}`)
    .optional(),

  /** Owner EOA private key for the Stable Protection hook's peg-reference admin.
   *  The peg-sync keeper signs `setPegReference` (EUR/USD) with it. Absent →
   *  the keeper is disabled (503). Moves no user funds; only sets the FX
   *  reference. Fund this address with ETH (Base gas). */
  MANTUA_ADMIN_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),

  /** D-104 — mandatory dispute window: the delay, in seconds, between the
   *  moment an outcome passes the S-025 criteria gate and the on-chain
   *  resolve submission. During the window an operator can hold or dispute;
   *  only an unheld, still-VERIFIED outcome submits once it elapses. 0 is
   *  allowed for tests/dev (the first pass then opens-and-submits in one
   *  sweep) but is flagged as a deploy hazard in production by
   *  `resolutionDisputeWindowIssues` below. Voids are exempt (B4-005:
   *  returning collateral cannot pick a wrong winner). */
  RESOLUTION_DISPUTE_WINDOW_SECONDS: z.coerce.number().int().min(0).default(900),

  /** Settlement signer — the Resolver contract's authorised `signer` key
   *  (B4). Signs market creation (`createMarketIfAbsent`), freeze sweeps,
   *  and resolve/void submissions. Absent → market creation is skipped and
   *  /api/cron/resolution stays a 503 dry run. Holds no user funds; fund
   *  with ETH for Base gas. */
  MARKET_SIGNER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
});

export type Env = z.infer<typeof schema>;

/**
 * Treat blank `.env` values (`KEY=`) as unset. Zod's `.optional()`
 * accepts `undefined` but not `""`, so a stray empty line failed
 * validation for fields like `MANTUA_FEE_RECIPIENT` and crashed the
 * server on boot.
 */
function blankEnvToUndefined(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = typeof value === "string" && value.trim() === "" ? undefined : value;
  }
  return out;
}

/**
 * Cross-field checks on the Circle credential set that zod can't express
 * per-field. Returns human-readable problems; empty means the set is
 * coherent. Exported for the preflight script (`npm run circle:preflight`).
 *
 * The shape of the rule matters: Circle stays entirely optional (the server
 * must boot without it and 503 the agent routes), but once it IS configured
 * in production the half-configured states below are deploy hazards rather
 * than degradations, so they fail the boot instead of warning into a log
 * nobody reads.
 */
export function circleCredentialIssues(e: Env): string[] {
  const configured = Boolean(e.CIRCLE_API_KEY && e.CIRCLE_ENTITY_SECRET);
  if (!configured) {
    // Half a credential pair is always a mistake, even outside production.
    if (e.CIRCLE_API_KEY || e.CIRCLE_ENTITY_SECRET) {
      return [
        "CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set together — one without the other leaves every agent route disabled.",
      ];
    }
    return [];
  }

  const issues: string[] = [];
  if (!e.CIRCLE_WALLET_SET_ID) {
    issues.push(
      "CIRCLE_WALLET_SET_ID is unset: each cold start would mint a NEW wallet set, scattering user wallets outside the Gas Station policy bound to the intended set. Create one, then pin its id.",
    );
  }
  if (!e.CIRCLE_GAS_STATION_POLICY_ID) {
    issues.push(
      "CIRCLE_GAS_STATION_POLICY_ID is unset: agent transactions are unsponsored, so they fail on an SCA wallet holding no ETH — and surface as an opaque timeout. In Console → Gas Station, create a policy for this wallet set on Base, ACTIVATE it, and make it the default policy for Base (transactions use only the network's default policy) — then record its id.",
    );
  }
  if (/^TEST_API_KEY:/i.test(e.CIRCLE_API_KEY ?? "")) {
    issues.push(
      "CIRCLE_API_KEY is a TEST key — the agent would be operating on testnet while the rest of the app is on Base Mainnet. Use a LIVE key.",
    );
  }
  return issues;
}

/**
 * Cross-field check for the shared rate-limit store (C-021): the Upstash
 * REST URL and token are a pair. Half a pair silently degrades every limiter
 * to per-instance counting — the exact behavior C-021 removes — so like any
 * half-configured deploy hazard (see circleCredentialIssues) it warns in
 * development and fails the production boot.
 */
export function rateLimitStoreIssues(e: Env): string[] {
  if (Boolean(e.UPSTASH_REDIS_REST_URL) === Boolean(e.UPSTASH_REDIS_REST_TOKEN)) return [];
  return [
    "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together — one without the other silently degrades rate limiting to per-instance memory (see docs/ops/incident-runbook.md).",
  ];
}

/**
 * D-104 startup check: a zero dispute window disables a mandatory
 * settlement protection. Fine for tests and local dev (warned), a deploy
 * hazard in production (fails the boot via the shared issues machinery,
 * same posture as circleCredentialIssues).
 */
export function resolutionDisputeWindowIssues(e: Env): string[] {
  if (e.RESOLUTION_DISPUTE_WINDOW_SECONDS > 0) return [];
  return [
    "RESOLUTION_DISPUTE_WINDOW_SECONDS is 0 — the D-104 dispute window is disabled and verified outcomes submit on-chain on the first sweep. Only acceptable for tests/dev; set a positive window (default 900) in production.",
  ];
}

export function loadEnv(): Env {
  const parsed = schema.safeParse(blankEnvToUndefined(process.env));
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    console.error(z.treeifyError(parsed.error));
    process.exit(1);
  }
  const issues = [
    ...circleCredentialIssues(parsed.data),
    ...rateLimitStoreIssues(parsed.data),
    ...resolutionDisputeWindowIssues(parsed.data),
    ...rpcProviderIssues(parsed.data),
  ];
  if (issues.length > 0) {
    const fatal = parsed.data.NODE_ENV === "production";
    console[fatal ? "error" : "warn"](`Configuration ${fatal ? "errors" : "warnings"}:`);
    for (const issue of issues) console[fatal ? "error" : "warn"](`  - ${issue}`);
    if (fatal) process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
