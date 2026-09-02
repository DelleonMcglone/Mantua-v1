import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  // Prefer the direct (non-pooled) connection for migrations: DDL over Neon's
  // PgBouncer pooler can choke, and migrations run rarely so pooling buys
  // nothing here. Falls back to the pooled URL, then empty for tooling that
  // only needs the schema (e.g. `generate`).
  dbCredentials: {
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.DATABASE_URL ??
      "",
  },
  strict: true,
  verbose: true,
});
