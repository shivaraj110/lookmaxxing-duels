import Redis from "ioredis";

export const DUEL_CHANNEL = "duel_events";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6380";

// Survive Next.js dev hot-reloads without leaking connections. This is the
// publisher; a subscriber needs its own dedicated connection (see ws-server).
const g = globalThis as unknown as { __duelsRedis?: Redis };

export const redis: Redis =
  g.__duelsRedis ?? (g.__duelsRedis = new Redis(REDIS_URL));
