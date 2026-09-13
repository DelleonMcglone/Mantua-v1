/**
 * Task 067 (G-014) — recorded legal acceptances. One row per (user, doc,
 * version): which Terms version a user agreed to and when. The current
 * version is a constant in `lib/legal.ts`; a bump asks every user once more.
 */
import { sql } from "drizzle-orm";
import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

export const legalAcceptances = pgTable(
  "legal_acceptances",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "terms" | "privacy" — see LEGAL_DOCS. */
    doc: varchar("doc", { length: 16 }).notNull(),
    /** The document version accepted, e.g. "2026-09-13". */
    version: varchar("version", { length: 16 }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("legal_acceptances_user_doc_version_idx").on(t.userId, t.doc, t.version),
    index("legal_acceptances_user_idx").on(t.userId),
  ],
);

export type LegalAcceptance = typeof legalAcceptances.$inferSelect;
