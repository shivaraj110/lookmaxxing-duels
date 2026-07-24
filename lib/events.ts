import { Redis as UpstashRedis } from "@upstash/redis";
import type { DuelEvent } from "./types";

// Must match the ws-server's channel.
const DUEL_CHANNEL = "duel_events";

// On Vercel (serverless), publish over Upstash's REST API: it's a stateless
// HTTP call, so it survives function suspension — unlike a persistent ioredis
// TCP socket, which can be frozen/dropped between invocations and silently
// drop the publish (that's what made realtime updates require a manual refresh).
// Locally (no Upstash env), fall back to ioredis against the dev Docker Redis.
const upstash =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new UpstashRedis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

/**
 * Fan out a duel event to the ws-server via Redis pub/sub. The payload is a
 * plain JSON string; the ws-server forwards it verbatim to browser rooms.
 */
export async function publishDuelEvent(event: DuelEvent) {
  const payload = JSON.stringify(event);
  try {
    if (upstash) {
      await upstash.publish(DUEL_CHANNEL, payload);
    } else {
      const { redis } = await import("./redis");
      await redis.publish(DUEL_CHANNEL, payload);
    }
  } catch (err) {
    console.error("publishDuelEvent failed:", err);
  }
}
