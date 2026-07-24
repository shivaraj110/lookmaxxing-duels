import { DUEL_CHANNEL, redis } from "./redis";
import type { DuelEvent } from "./types";

/**
 * Fan out a duel event via Redis pub/sub. The standalone WebSocket server
 * (ws-server.ts) subscribes to this channel and broadcasts each event to
 * every browser watching the duel.
 */
export async function publishDuelEvent(event: DuelEvent) {
  try {
    await redis.publish(DUEL_CHANNEL, JSON.stringify(event));
  } catch (err) {
    console.error("publishDuelEvent failed:", err);
  }
}
