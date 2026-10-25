/**
 * The forecast ledger (owner, 2026-10-24): one row every time the agent
 * forms a probability on a market — scans it passed on, research, the
 * proposals the user saw, and the fills. Append-only at the database
 * (migration 0033 installs the same refuse-update-or-delete trigger as
 * `market_fills`); a new view is a new row. Outcomes live in
 * `forecast_outcomes`, one row per market, joined at scoring time, so a
 * forecast row is never written twice.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const FORECAST_SOURCES = ["scan", "research", "proposal"] as const;
export type ForecastSource = (typeof FORECAST_SOURCES)[number];

export const FORECAST_ACTIONS = [
  "no_trade",
  "proposed",
  "rejected_by_user",
  "unfilled",
  "filled",
] as const;
export type ForecastAction = (typeof FORECAST_ACTIONS)[number];

export const forecasts = pgTable(
  "forecasts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id"),
    sessionId: varchar("session_id", { length: 64 }),
    /** Null while no Mantua market exists for the game yet. */
    marketId: varchar("market_id", { length: 66 }),
    providerEventId: varchar("provider_event_id", { length: 64 }).notNull(),
    league: varchar("league", { length: 16 }),
    eventStartsAt: timestamp("event_starts_at", { withTimezone: true }).notNull(),
    /** 0 home, 1 away — the side the probability refers to. */
    outcomeIndex: smallint("outcome_index").notNull(),
    outcomeLabel: varchar("outcome_label", { length: 120 }).notNull(),
    /** The agent's probability for the outcome, basis points (0–10000). */
    agentProbabilityBps: integer("agent_probability_bps").notNull(),
    confidence: varchar("confidence", { length: 8 }),
    /** De-vigged sportsbook line for the same side at the same moment. */
    referenceBookBps: integer("reference_book_bps"),
    /** Mantua's pool price for the side at the same moment, when a market existed. */
    referencePoolBps: integer("reference_pool_bps"),
    liquidityUsdc: numeric("liquidity_usdc", { precision: 18, scale: 6 }),
    source: varchar("source", { length: 16 }).notNull(),
    action: varchar("action", { length: 20 }).notNull(),
    /** The fill's transaction hash when `action` is filled. */
    tradeId: varchar("trade_id", { length: 66 }),
    modelVersion: varchar("model_version", { length: 64 }).notNull(),
    inputsSnapshot: jsonb("inputs_snapshot").notNull(),
    /** Logged at or after kickoff — kept for the record, excluded from scoring. */
    afterKickoff: boolean("after_kickoff").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("forecasts_market_time_idx").on(t.marketId, t.createdAt),
    index("forecasts_event_idx").on(t.providerEventId),
    index("forecasts_user_idx").on(t.userId, t.createdAt),
    index("forecasts_created_idx").on(t.createdAt),
  ],
);

export type ForecastRow = typeof forecasts.$inferSelect;
export type NewForecastRow = typeof forecasts.$inferInsert;

/**
 * One row per market, written by the live tick (closing reference at the
 * last pre-kickoff pass) and the resolution writer (the outcome). Scoring
 * joins it to every forecast row for the market.
 */
export const forecastOutcomes = pgTable("forecast_outcomes", {
  marketId: varchar("market_id", { length: 66 }).primaryKey(),
  providerEventId: varchar("provider_event_id", { length: 64 }).notNull(),
  eventStartsAt: timestamp("event_starts_at", { withTimezone: true }).notNull(),
  /** Home-side (outcome 0) sportsbook line at the last pre-kickoff tick. */
  closingBookBps: integer("closing_book_bps"),
  /** Home-side pool price at the last pre-kickoff tick. */
  closingPoolBps: integer("closing_pool_bps"),
  closingCapturedAt: timestamp("closing_captured_at", { withTimezone: true }),
  /** Winning outcome index; null with `voided` true when the market is INVALID. */
  winningOutcomeIndex: smallint("winning_outcome_index"),
  voided: boolean("voided").notNull().default(false),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ForecastOutcomeRow = typeof forecastOutcomes.$inferSelect;
