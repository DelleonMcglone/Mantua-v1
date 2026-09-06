import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  bigint,
  integer,
  smallint,
  boolean,
  text,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { events } from "./markets.ts";
import { teams } from "./markets.ts";

/**
 * Canonical sports-stats extension (task 038, S-005..S-007).
 *
 * Two tables close the gaps the B0-005/0009 schema left open: play-by-play
 * (S-005) and standings/records with team season aggregates (S-006/S-007).
 * Player season stats deliberately did NOT get a table — they live in a
 * `season_stats` jsonb column on `players` (keyed by season string) with a
 * typed reader in `lib/sports/history.ts`, per the jsonb-over-table-sprawl
 * preference.
 *
 * Nothing here is written yet — ingestion wiring is a sibling task. The
 * read layer (`history.ts`) treats empty tables as explicit
 * "insufficient data", never as zeros.
 */

/**
 * Append-only play-by-play (S-005). One row per provider play; `sequence`
 * is the provider's monotonically increasing play index within the game,
 * so replaying an ingest is an upsert no-op via the (event, provider,
 * sequence) unique. Rows are never updated — a corrected play arrives as
 * a new sequence entry from the provider, exactly like their own feeds.
 */
export const gamePlays = pgTable(
  "game_plays",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    /** Provider's play ordering within the game — the append cursor.
     *  Bigint (migration 0015): Sportradar documents pbp `sequence` as an
     *  epoch-milliseconds-scale number, which overflows int4. Values stay
     *  far below 2^53, so number mode is safe. */
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    /** Period/quarter/half/inning number, provider-normalised. */
    period: smallint("period"),
    /** Game clock at the play, provider format (e.g. "12:34"). */
    clock: varchar("clock", { length: 16 }),
    /** Normalised play type slug, e.g. "rush", "pass", "field-goal". */
    playType: varchar("play_type", { length: 32 }),
    description: text("description"),
    /** Provider-agnostic key of the team credited with the play. */
    teamKey: varchar("team_key", { length: 64 }),
    scoringPlay: boolean("scoring_play").notNull().default(false),
    /** Running score AFTER the play, when the provider reports it. */
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    /** Provider-specific extras (yardage, players involved, win prob…). */
    detail: jsonb("detail")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("game_plays_event_provider_seq_uq").on(t.eventId, t.provider, t.sequence),
    index("game_plays_event_seq_idx").on(t.eventId, t.sequence),
  ],
);

export type GamePlay = typeof gamePlays.$inferSelect;
export type NewGamePlay = typeof gamePlays.$inferInsert;

/**
 * Standings/record snapshot per team + season (S-006), with team season
 * stat aggregates riding the `stats` jsonb (S-007) — the (team, season)
 * dimension is identical, so a second table would only duplicate the key.
 * One row per (team, season, seasonType), overwritten in place by ingest;
 * `updatedAt` is the staleness signal for readers.
 */
export const teamRecords = pgTable(
  "team_records",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    /** Season label, e.g. "2026". Varchar because leagues cross years. */
    season: varchar("season", { length: 16 }).notNull(),
    /** regular | preseason | postseason */
    seasonType: varchar("season_type", { length: 16 }).notNull().default("regular"),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    ties: integer("ties").notNull().default(0),
    divisionRank: smallint("division_rank"),
    conferenceRank: smallint("conference_rank"),
    pointsFor: integer("points_for"),
    pointsAgainst: integer("points_against"),
    /** Provider streak notation, e.g. "W3", "L1". */
    streak: varchar("streak", { length: 16 }),
    /** Provider-published home/away splits, e.g. "5-2". */
    homeRecord: varchar("home_record", { length: 16 }),
    awayRecord: varchar("away_record", { length: 16 }),
    provider: varchar("provider", { length: 32 }),
    /** Team season stat aggregates (S-007): totals/averages per category,
     *  provider-normalised. Typed reader: `teamSeasonStats` in history.ts. */
    stats: jsonb("stats")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("team_records_team_season_uq").on(t.teamId, t.season, t.seasonType),
    index("team_records_team_idx").on(t.teamId),
    index("team_records_season_idx").on(t.season, t.seasonType),
  ],
);

export type TeamRecord = typeof teamRecords.$inferSelect;
export type NewTeamRecord = typeof teamRecords.$inferInsert;
