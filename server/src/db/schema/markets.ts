import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  index,
  integer,
  smallint,
  boolean,
  text,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * Sports prediction market schema — B0-005.
 *
 * Shape follows the lifecycle in `docs/specs/market-lifecycle.md` and the ID
 * scheme in `docs/specs/market-id.md`.
 *
 * Two conventions carried from the rest of the schema:
 *  - money and token amounts are `numeric`, never float — these are financial
 *    quantities and binary floating point is not safe for them;
 *  - every provider-sourced row keeps both our own UUID and the provider's
 *    identifier, so a provider change does not orphan our records (B3-004).
 */

// ─── Catalog ─────────────────────────────────────────────────────────────────

/** Sports we model. One row per sport; leagues hang off it. */
export const sports = pgTable("sports", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** Stable slug matching `SportId` in `client/src/features/markets/sports.ts`. */
  slug: varchar("slug", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Sport = typeof sports.$inferSelect;
export type NewSport = typeof sports.$inferInsert;

/**
 * Leagues. `coverage` mirrors the client catalog (DM-105): `launch` leagues
 * are ingested and generate markets; `soon` leagues are listed but dormant.
 * The ingest worker reads this column — promoting a league is a data change,
 * not a deploy.
 */
export const leagues = pgTable(
  "leagues",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sportId: uuid("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 64 }).notNull(),
    coverage: varchar("coverage", { length: 8 }).notNull().default("soon"),
    /** Provider path/key for the slate endpoint, e.g. "football/nfl". */
    providerKey: varchar("provider_key", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leagues_sport_idx").on(t.sportId), index("leagues_coverage_idx").on(t.coverage)],
);

export type League = typeof leagues.$inferSelect;
export type NewLeague = typeof leagues.$inferInsert;

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * A scheduled game, normalised from a provider (B3-004).
 *
 * `providerEventId` is unique per provider and is what the market ID hashes
 * (B0-004) — so it is load-bearing, not merely a breadcrumb. Home and away are
 * assigned here, which is what fixes `outcomeIndex` for the market ID: a
 * provider reordering teams must never flip what a YES token means.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 128 }).notNull(),
    homeTeam: varchar("home_team", { length: 96 }).notNull(),
    awayTeam: varchar("away_team", { length: 96 }).notNull(),
    /** Provider-agnostic team keys, for cross-provider matching (B3-004). */
    homeTeamKey: varchar("home_team_key", { length: 64 }),
    awayTeamKey: varchar("away_team_key", { length: 64 }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** scheduled | in_progress | final | postponed | cancelled */
    status: varchar("status", { length: 16 }).notNull().default("scheduled"),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    /** When the ingest worker last saw this event (B3-005). */
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per provider event — makes slate refresh an upsert, so
    // re-running the ingest worker cannot duplicate a game.
    unique("events_provider_event_uq").on(t.provider, t.providerEventId),
    index("events_league_starts_idx").on(t.leagueId, t.startsAt),
    index("events_status_idx").on(t.status),
  ],
);

export type SportsEvent = typeof events.$inferSelect;
export type NewSportsEvent = typeof events.$inferInsert;

// ─── Markets ─────────────────────────────────────────────────────────────────

/**
 * One market per (event, market type, outcome). `marketId` is the
 * deterministic hash from `server/src/lib/market-id.ts` and is the primary
 * key everything else joins on — it is the same value the contracts use.
 */
export const markets = pgTable(
  "markets",
  {
    /** 0x-prefixed keccak256, 66 chars. Deterministic per B0-004. */
    marketId: varchar("market_id", { length: 66 }).primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** moneyline (DM-106). Totals/spreads deferred. */
    marketType: varchar("market_type", { length: 16 }).notNull().default("moneyline"),
    /** Which outcome the YES token represents. Moneyline: 0 home, 1 away. */
    outcomeIndex: smallint("outcome_index").notNull(),
    /** Chain this market lives on (8453 = Base Mainnet). */
    chainId: integer("chain_id").notNull().default(8453),
    /** OPEN | FROZEN | RESOLVED | SETTLED | INVALID — see the lifecycle spec. */
    state: varchar("state", { length: 16 }).notNull().default("OPEN"),
    yesToken: varchar("yes_token", { length: 42 }),
    noToken: varchar("no_token", { length: 42 }),
    /** v4 pool id for the YES/USDC pool, once seeded (B1-009). */
    poolId: varchar("pool_id", { length: 66 }),
    /** Implied probability the pool was seeded at, 0–1. */
    openingProbability: numeric("opening_probability", { precision: 6, scale: 5 }),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("markets_event_type_outcome_chain_uq").on(
      t.eventId,
      t.marketType,
      t.outcomeIndex,
      t.chainId,
    ),
    index("markets_state_idx").on(t.state),
    index("markets_event_idx").on(t.eventId),
  ],
);

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;

/**
 * The outcomes a market can settle to, and which one won. Kept as its own
 * table rather than a column on `markets` so the display label for each side
 * lives with the outcome and multi-outcome markets need no reshaping later.
 */
export const marketOutcomes = pgTable(
  "market_outcomes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    marketId: varchar("market_id", { length: 66 })
      .notNull()
      .references(() => markets.marketId, { onDelete: "cascade" }),
    outcomeIndex: smallint("outcome_index").notNull(),
    label: varchar("label", { length: 96 }).notNull(),
    /** Set on resolution. Null until then — "not yet known" and "lost" are
     *  different states, so this must stay nullable and never default. */
    isWinner: boolean("is_winner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("market_outcomes_market_index_uq").on(t.marketId, t.outcomeIndex),
    index("market_outcomes_market_idx").on(t.marketId),
  ],
);

export type MarketOutcome = typeof marketOutcomes.$inferSelect;
export type NewMarketOutcome = typeof marketOutcomes.$inferInsert;

/**
 * A user's position in a market. Server-side mirror of on-chain balances,
 * kept so the portfolio can show entry price and P/L — which the chain does
 * not record. The chain remains authoritative for the balance itself.
 */
export const marketPositions = pgTable(
  "market_positions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    marketId: varchar("market_id", { length: 66 })
      .notNull()
      .references(() => markets.marketId, { onDelete: "cascade" }),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    /** yes | no */
    side: varchar("side", { length: 3 }).notNull(),
    /** Token amount, 6dp raw units as a decimal string. */
    size: numeric("size", { precision: 78, scale: 0 }).notNull(),
    /** Average entry as implied probability, 0–1. */
    entryPrice: numeric("entry_price", { precision: 6, scale: 5 }),
    /** Set once redeemed, so the portfolio can show realised P/L. */
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemTxHash: varchar("redeem_tx_hash", { length: 66 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("market_positions_user_idx").on(t.userId),
    index("market_positions_market_idx").on(t.marketId),
    index("market_positions_wallet_idx").on(t.walletAddress),
  ],
);

export type MarketPosition = typeof marketPositions.$inferSelect;
export type NewMarketPosition = typeof marketPositions.$inferInsert;

/**
 * Resolution record — the public log required by B4-006. One row per
 * resolution attempt, including manual overrides, so the reason a market
 * settled the way it did is auditable after the fact.
 */
export const resolutions = pgTable(
  "resolutions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    marketId: varchar("market_id", { length: 66 })
      .notNull()
      .references(() => markets.marketId, { onDelete: "cascade" }),
    winningOutcomeIndex: smallint("winning_outcome_index"),
    /** auto | manual | void — void carries a null winning outcome. */
    method: varchar("method", { length: 8 }).notNull(),
    /** Which provider(s) the outcome was derived from. */
    source: varchar("source", { length: 64 }),
    /** Raw provider payloads that justified the call, for postmortems. */
    sourcePayload: jsonb("source_payload"),
    /** Address that signed the on-chain resolution. */
    signer: varchar("signer", { length: 42 }),
    txHash: varchar("tx_hash", { length: 66 }),
    /** Free-text justification. Required for manual overrides. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resolutions_market_idx").on(t.marketId)],
);

export type Resolution = typeof resolutions.$inferSelect;
export type NewResolution = typeof resolutions.$inferInsert;

// ─── Hedging ─────────────────────────────────────────────────────────────────

/**
 * An armed hedging strategy (B9-001). `config` is jsonb because the trigger
 * and action shape differ per strategy type and will keep changing; the
 * columns beside it are the ones the execution engine and kill switch need to
 * query without parsing json.
 */
export const hedgeStrategies = pgTable(
  "hedge_strategies",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null for strategies spanning correlated markets (B9-003). */
    marketId: varchar("market_id", { length: 66 }).references(() => markets.marketId, {
      onDelete: "cascade",
    }),
    /** take_profit | stop | delta_hedge */
    strategyType: varchar("strategy_type", { length: 24 }).notNull(),
    /** armed | triggered | executed | expired | disarmed */
    status: varchar("status", { length: 16 }).notNull().default("armed"),
    /** Trigger + action + size, per strategy type. */
    config: jsonb("config").notNull(),
    /** Hard ceiling on USDC this strategy may spend, independent of the wallet cap. */
    capUsd: numeric("cap_usd", { precision: 20, scale: 2 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    armedAt: timestamp("armed_at", { withTimezone: true }).notNull().defaultNow(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    /** Why it stopped — freeze auto-disarm, kill switch, expiry, user action. */
    disarmedReason: varchar("disarmed_reason", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("hedge_strategies_user_idx").on(t.userId),
    index("hedge_strategies_market_idx").on(t.marketId),
    // The execution engine sweeps by status on every tick.
    index("hedge_strategies_status_idx").on(t.status),
  ],
);

export type HedgeStrategy = typeof hedgeStrategies.$inferSelect;
export type NewHedgeStrategy = typeof hedgeStrategies.$inferInsert;

/**
 * Indexed trade fills — the basis for entry price and realized P&L
 * (B6-009's final slice). One row per confirmed swap; written by the
 * client after its transaction confirms and VERIFIED server-side against
 * the receipt (tx succeeded, target was our router, sender matches) —
 * trust-but-verify, keyed unique on the tx hash so replays no-op.
 */
export const marketFills = pgTable(
  "market_fills",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** The trader's wallet address. */
    address: varchar("address", { length: 42 }).notNull(),
    marketId: varchar("market_id", { length: 66 })
      .notNull()
      .references(() => markets.marketId, { onDelete: "cascade" }),
    /** buy = USDC in, YES out; sell = the reverse. */
    direction: varchar("direction", { length: 4 }).notNull(),
    tokensRaw: varchar("tokens_raw", { length: 32 }).notNull(),
    usdcRaw: varchar("usdc_raw", { length: 32 }).notNull(),
    txHash: varchar("tx_hash", { length: 66 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("market_fills_addr_market_idx").on(t.address, t.marketId)],
);

export type MarketFill = typeof marketFills.$inferSelect;

/**
 * Comment thread on a game's market page (the Polymarket-style detail
 * view). Keyed by the provider event id — not the market id — so one
 * thread covers both outcome markets and survives market re-creation.
 */
export const marketComments = pgTable(
  "market_comments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    providerEventId: varchar("provider_event_id", { length: 128 }).notNull(),
    /** The commenter's wallet address (their public identity here). */
    address: varchar("address", { length: 42 }).notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("market_comments_event_idx").on(t.providerEventId, t.createdAt)],
);

export type MarketComment = typeof marketComments.$inferSelect;
