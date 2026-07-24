import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { duels } from "./schema";
import { publishDuelEvent } from "./events";
import { localDateStr, resolveDuel } from "./duels";
import type { Checkin, Duel } from "./types";

/**
 * Lazily settle an active duel (missed days / rejections / completion).
 * Called on duel-page load; persists the outcome exactly once (guarded by
 * the status = 'active' filter on the update).
 */
export async function maybeResolveDuel(
  duel: Duel,
  checkins: Checkin[]
): Promise<Duel> {
  const resolution = resolveDuel(duel, checkins, localDateStr());
  if (!resolution) return duel;

  const d = await db();
  const rows = await d
    .update(duels)
    .set(resolution)
    .where(and(eq(duels.id, duel.id), eq(duels.status, "active")))
    .returning();
  if (!rows[0]) return duel; // someone else resolved it first

  await publishDuelEvent({ duelId: duel.id, kind: "duel" });
  return rows[0];
}
