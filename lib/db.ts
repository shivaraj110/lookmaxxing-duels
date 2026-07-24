import path from "node:path";
import { Pool, types as pgTypes } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "./schema";

// Keep `date` columns as YYYY-MM-DD strings instead of JS Dates.
pgTypes.setTypeParser(1082, (v) => v);

export type Db = NodePgDatabase<typeof schema>;

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? "postgres://duels:duels@127.0.0.1:5433/duels";

/**
 * Managed Postgres (Supabase, etc.) requires TLS; local Docker doesn't.
 * `rejectUnauthorized: false` because Supabase's pooler presents a cert for a
 * shared hostname that won't chain-validate against the connection host.
 */
export function sslFor(url: string) {
  return /sslmode=require|supabase\.com|\.pooler\./.test(url)
    ? { rejectUnauthorized: false }
    : undefined;
}

// Survive Next.js dev hot-reloads without leaking pools.
const g = globalThis as unknown as {
  __duelsPool?: Pool;
  __duelsDb?: Db;
  __duelsReady?: Promise<void>;
};

export const pool: Pool =
  g.__duelsPool ??
  (g.__duelsPool = new Pool({
    connectionString: CONNECTION_STRING,
    ssl: sslFor(CONNECTION_STRING),
  }));

const client: Db = g.__duelsDb ?? (g.__duelsDb = drizzle(pool, { schema }));

/** Returns the Drizzle instance after running migrations (once per process). */
export function db(): Promise<Db> {
  if (!g.__duelsReady) {
    g.__duelsReady = migrate(client, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
  }
  return g.__duelsReady.then(() => client);
}
