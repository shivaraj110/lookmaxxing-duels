import { sql } from "drizzle-orm";
import { db } from "./db";
import type { DuelEvent } from "./types";

/**
 * Fan out a duel event via Postgres NOTIFY. The standalone WebSocket
 * server (ws-server.ts) LISTENs on this channel and broadcasts to every
 * browser watching the duel.
 */
export async function publishDuelEvent(event: DuelEvent) {
  try {
    const d = await db();
    await d.execute(
      sql`select pg_notify('duel_events', ${JSON.stringify(event)})`
    );
  } catch (err) {
    console.error("publishDuelEvent failed:", err);
  }
}
