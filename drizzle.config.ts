import { defineConfig } from "drizzle-kit";

// `drizzle-kit migrate` runs DDL, so point DATABASE_URL at a SESSION connection
// (Supabase session pooler, port 5432) — not the transaction pooler (6543).
const url =
  process.env.DATABASE_URL ?? "postgres://duels:duels@127.0.0.1:5433/duels";

// Managed Postgres (Supabase) requires TLS; local Docker doesn't.
const needsSsl = /supabase\.com|\.pooler\.|sslmode=/.test(url);

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dbCredentials: needsSsl
    ? { url, ssl: { rejectUnauthorized: false } }
    : { url },
});
