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

/**
 * Teams, normalised per league. `key` is the provider-agnostic slug the
 * ingest worker matches on (the same value `events.home_team_key` carries),
 * so a provider change re-links rather than duplicates. Events keep their
 * denormalised name columns for display; the FK columns added there are the
 * relational link.
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    /** Provider-agnostic team key, e.g. "kc", "lv" — unique within a league. */
    key: varchar("key", { length: 64 }).notNull(),
    name: varchar("name", { length: 96 }).notNull(),
    shortName: varchar("short_name", { length: 48 }),
    abbreviation: varchar("abbreviation", { length: 8 }),
    logoUrl: varchar("logo_url", { length: 512 }),
    provider: varchar("provider", { length: 32 }),
    providerTeamId: varchar("provider_team_id", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("teams_league_key_uq").on(t.leagueId, t.key),
    index("teams_league_idx").on(t.leagueId),
  ],
);

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

/**
 * Players. `teamId` is nullable — free agents and mid-trade players exist,
 * and injury rows must survive a roster move. Keyed unique on the provider
 * pair per the B3-004 convention.
 */
export const players = pgTable(
  "players",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    name: varchar("name", { length: 96 }).notNull(),
    position: varchar("position", { length: 16 }),
    jerseyNumber: smallint("jersey_number"),
    /** active | inactive | retired */
    status: varchar("status", { length: 16 }).notNull().default("active"),
    /**
     * Player season stat aggregates keyed by season label, e.g.
     * `{"2026": {"passingYards": 3120, ...}}` (task 038, S-007). Jsonb by
     * design — stat categories differ per sport and provider, and the
     * (player, season) dimension fits one keyed object without a new
     * table. Typed reader: `playerSeasonStats` in lib/sports/history.ts.
     */
    seasonStats: jsonb("season_stats")
      .notNull()
      .default(sql`'{}'::jsonb`),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerPlayerId: varchar("provider_player_id", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("players_provider_uq").on(t.provider, t.providerPlayerId),
    index("players_team_idx").on(t.teamId),
    index("players_league_idx").on(t.leagueId),
  ],
);

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;

/**
 * Injury reports — a pricing signal for the odds engine, not medical truth.
 * One row per report; a player's current status is the latest open row
 * (`resolvedAt` null). `teamId` is denormalised from the player so the
 * "who's out for tonight's game" query needs no join through rosters that
 * may have changed since the report.
 */
export const injuries = pgTable(
  "injuries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** out | doubtful | questionable | probable | day_to_day | ir */
    status: varchar("status", { length: 16 }).notNull(),
    /** e.g. "hamstring", "concussion protocol". */
    description: varchar("description", { length: 256 }),
    provider: varchar("provider", { length: 32 }).notNull(),
    /** Provider's own last-updated stamp, for staleness checks. */
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the player returns — null means the report is still live. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("injuries_player_idx").on(t.playerId),
    index("injuries_team_idx").on(t.teamId),
    // The odds engine sweeps live reports only.
    index("injuries_open_idx").on(t.resolvedAt),
  ],
);

export type Injury = typeof injuries.$inferSelect;
export type NewInjury = typeof injuries.$inferInsert;

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
    /** Relational team links. Nullable — backfilled by ingest as teams land. */
    homeTeamId: uuid("home_team_id").references(() => teams.id, { onDelete: "set null" }),
    awayTeamId: uuid("away_team_id").references(() => teams.id, { onDelete: "set null" }),
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
 * Price history — one row per capture of a market's implied probability,
 * written by the sports-sync sweep and read by the detail-page chart.
 * Append-only time series: no updates, no unique key beyond the id, and the
 * composite index is (market, time desc) because every read is "latest N
 * for one market". Retention/downsampling is the sweep's job, not the
 * schema's.
 */
export const marketPrices = pgTable(
  "market_prices",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    marketId: varchar("market_id", { length: 66 })
      .notNull()
      .references(() => markets.marketId, { onDelete: "cascade" }),
    /** Implied probability of the YES outcome, 0–1. */
    impliedProbability: numeric("implied_probability", { precision: 6, scale: 5 }).notNull(),
    /** pool | consensus | opening — where the observation came from. */
    source: varchar("source", { length: 16 }).notNull().default("pool"),
    /** Pool depth at capture, USDC 6dp raw units — context for the chart. */
    liquidityRaw: numeric("liquidity_raw", { precision: 78, scale: 0 }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("market_prices_market_time_idx").on(t.marketId, t.capturedAt)],
);

export type MarketPrice = typeof marketPrices.$inferSelect;
export type NewMarketPrice = typeof marketPrices.$inferInsert;

// ─── Combos (parlays) ────────────────────────────────────────────────────────

/**
 * A combo (parlay) ticket — several market legs that must all win.
 * SCHEMA ONLY for now: the feature ships later, but the tables land ahead of
 * it (deliberate) so position/fill writers can reference combo ids without a
 * follow-up migration. Nothing writes these tables yet.
 */
export const combos = pgTable(
  "combos",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    /** draft | open | won | lost | void */
    status: varchar("status", { length: 8 }).notNull().default("draft"),
    /** Stake, USDC 6dp raw units. */
    stakeRaw: numeric("stake_raw", { precision: 78, scale: 0 }),
    /** Product of the legs' entry odds at placement, as a decimal multiplier. */
    combinedOdds: numeric("combined_odds", { precision: 12, scale: 6 }),
    /** Stake × combinedOdds at placement, USDC 6dp raw units. */
    potentialPayoutRaw: numeric("potential_payout_raw", { precision: 78, scale: 0 }),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("combos_user_idx").on(t.userId), index("combos_status_idx").on(t.status)],
);

export type Combo = typeof combos.$inferSelect;
export type NewCombo = typeof combos.$inferInsert;

/** One leg of a combo. A market appears at most once per ticket. */
export const comboLegs = pgTable(
  "combo_legs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    comboId: uuid("combo_id")
      .notNull()
      .references(() => combos.id, { onDelete: "cascade" }),
    marketId: varchar("market_id", { length: 66 })
      .notNull()
      .references(() => markets.marketId, { onDelete: "cascade" }),
    /** yes | no */
    side: varchar("side", { length: 3 }).notNull(),
    /** Entry as implied probability at placement, 0–1. */
    entryPrice: numeric("entry_price", { precision: 6, scale: 5 }),
    /** pending | won | lost | void */
    result: varchar("result", { length: 8 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("combo_legs_combo_market_uq").on(t.comboId, t.marketId),
    index("combo_legs_market_idx").on(t.marketId),
  ],
);

export type ComboLeg = typeof comboLegs.$inferSelect;
export type NewComboLeg = typeof comboLegs.$inferInsert;

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
    /** S-024 confidence state at the moment of the write (VERIFIED /
     *  RESOLVED for automated resolves; null for pre-040 rows and voids). */
    confidenceState: varchar("confidence_state", { length: 24 }),
    /** D-104 dispute window this resolve waited out, stamped from the
     *  review row at write time. Null for voids, manual overrides, and
     *  pre-044 rows. */
    disputeWindowOpensAt: timestamp("dispute_window_opens_at", { withTimezone: true }),
    disputeWindowClosesAt: timestamp("dispute_window_closes_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resolutions_market_idx").on(t.marketId)],
);

export type Resolution = typeof resolutions.$inferSelect;
export type NewResolution = typeof resolutions.$inferInsert;

/**
 * S-024 — one row per game outcome the pipeline is tracking toward
 * settlement, carrying the explicit confidence state machine defined in
 * `server/src/lib/sports/resolution-confidence.ts` (the ONLY place
 * transitions live). Keyed by (provider event, chain) rather than market:
 * confidence is about the game's outcome, and both of a game's markets
 * settle from the same review.
 *
 * `history` is an append-only jsonb array of `{state, at, reason}` steps —
 * the audit trail S-026 wants for "how did we come to believe this".
 */
export const resolutionReviews = pgTable(
  "resolution_reviews",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    providerEventId: varchar("provider_event_id", { length: 128 }).notNull(),
    chainId: integer("chain_id").notNull().default(8453),
    /** PENDING_RECONCILIATION | VERIFIED | DISPUTED | MANUAL_REVIEW | RESOLVED */
    state: varchar("state", { length: 24 }).notNull(),
    /** dual-source | single-source — the corroboration regime in force. */
    policy: varchar("policy", { length: 16 }).notNull(),
    /** Latest transition's reason, denormalised from history for querying. */
    reason: text("reason"),
    /** Game-vocabulary winner (0 home, 1 away) the review verified, if any. */
    winningOutcomeIndex: smallint("winning_outcome_index"),
    /** When a final was first observed — the reconciliation timeout clock. */
    firstFinalSeenAt: timestamp("first_final_seen_at", { withTimezone: true }),
    disputedAt: timestamp("disputed_at", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** D-104 dispute window: opened on the first pass the outcome clears the
     *  S-025 criteria gate; the on-chain submit waits until `closesAt` has
     *  passed. Cancelled (nulled) when the review escalates to DISPUTED, so
     *  a later re-verification opens a fresh window. */
    disputeWindowOpensAt: timestamp("dispute_window_opens_at", { withTimezone: true }),
    disputeWindowClosesAt: timestamp("dispute_window_closes_at", { withTimezone: true }),
    /** D-104 operator hold: while set, the elapsed window does NOT submit.
     *  Written only by the authenticated ops route, always with a note. */
    operatorHoldAt: timestamp("operator_hold_at", { withTimezone: true }),
    operatorHoldNote: text("operator_hold_note"),
    /** Append-only [{state, at, reason}] transition trail. */
    history: jsonb("history")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("resolution_reviews_event_chain_uq").on(t.providerEventId, t.chainId),
    // Operators sweep DISPUTED / MANUAL_REVIEW; the cron sweeps PENDING.
    index("resolution_reviews_state_idx").on(t.state),
  ],
);

export type ResolutionReview = typeof resolutionReviews.$inferSelect;
export type NewResolutionReview = typeof resolutionReviews.$inferInsert;

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
    /**
     * Counted execution failures (B9-005). A failed close releases the
     * claim back to `armed` and increments this; at MAX_EXECUTE_ATTEMPTS
     * the engine auto-disarms (`execute-failed`) instead of retrying
     * forever. Cap-holds do not count — the daily cap resets on its own.
     */
    executeAttempts: integer("execute_attempts").notNull().default(0),
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
