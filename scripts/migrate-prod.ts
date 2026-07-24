/**
 * Apply Drizzle migrations to a database as a deploy step.
 *
 *   MIGRATE_DATABASE_URL='postgresql://…' npx tsx scripts/migrate-prod.ts
 *
 * Use a SESSION connection (Supabase session pooler, port 5432) — the
 * transaction pooler (6543) can't run migration DDL/locks reliably. Uses the
 * same node-postgres migrator the app runs at startup, so the recorded
 * migration history is identical and the runtime migrate() becomes a no-op.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sslFor } from "../lib/db";

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Set MIGRATE_DATABASE_URL (or DATABASE_URL).");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: sslFor(url) });

async function main() {
  console.log("Migrating:", url!.replace(/:[^:@/]+@/, ":****@"));
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log("✅ migrations applied");
  await pool.end();
}

main().catch(async (e) => {
  console.error("❌ migration failed:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
