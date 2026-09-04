import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.url(),

  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),

  UNISWAP_TRADING_API_KEY: z.string().min(1).optional(),

  /** Network gate. Mantua runs on Base Mainnet — defaults to `mainnet`;
   *  the `testnet` option is retained for the shared IS_MAINNET guard. */
  MANTUA_NETWORK: z.enum(["mainnet", "testnet"]).default("mainnet"),

  /** Base Mainnet RPC URL — used by all server-side viem reads
   *  (StateView.getSlot0, portfolio balances, etc.). Override with a
   *  private endpoint (Alchemy/QuickNode) in production for headroom. */
  BASE_RPC_URL: z.url().default("https://mainnet.base.org"),

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
    .regex(/^[A-Z_]+:[0-9a-f]+:[0-9a-f]+$/i, "expected Circle's PREFIX:ID:SECRET key format")
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

  /** Gas Station (paymaster) policy id, from Console → Gas Station. There is
   *  no API credential for Gas Station on Developer-Controlled Wallets — the
   *  policy is console-side config bound to the wallet set + chain, and the
   *  SDK sponsors SCA transactions automatically once it exists. We record
   *  the id purely so the app can assert sponsorship was configured
   *  deliberately (see the preflight) rather than discovering an unsponsored
   *  wallet as a mystery timeout at execution time. */
  CIRCLE_GAS_STATION_POLICY_ID: z.string().min(1).optional(),

  /** Webhook signature key id for Circle transaction notifications. Circle
   *  recommends webhooks over polling for terminal transaction state; absent
   *  → the poller stays the only completion signal. */
  CIRCLE_WEBHOOK_KEY_ID: z.string().min(1).optional(),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

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

  /** Shared secret guarding the auto-rebalance cron endpoint. Vercel Cron sends
   *  it as `Authorization: Bearer <CRON_SECRET>`; an external scheduler can use
   *  the same header. Absent → the endpoint is disabled (503). */
  CRON_SECRET: z.string().min(1).optional(),

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
      "CIRCLE_GAS_STATION_POLICY_ID is unset: agent transactions are unsponsored, so they fail on an SCA wallet holding no ETH — and surface as an opaque timeout. Configure a Gas Station policy for this wallet set on Base, then record its id.",
    );
  }
  if (/^TEST_API_KEY:/i.test(e.CIRCLE_API_KEY ?? "")) {
    issues.push(
      "CIRCLE_API_KEY is a TEST key — the agent would be operating on testnet while the rest of the app is on Base Mainnet. Use a LIVE key.",
    );
  }
  return issues;
}

export function loadEnv(): Env {
  const parsed = schema.safeParse(blankEnvToUndefined(process.env));
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    console.error(z.treeifyError(parsed.error));
    process.exit(1);
  }
  const issues = circleCredentialIssues(parsed.data);
  if (issues.length > 0) {
    const fatal = parsed.data.NODE_ENV === "production";
    console[fatal ? "error" : "warn"](
      `Circle credential configuration ${fatal ? "is invalid" : "is incomplete"}:`,
    );
    for (const issue of issues) console[fatal ? "error" : "warn"](`  - ${issue}`);
    if (fatal) process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
