/**
 * Realtime WebSocket server.
 *
 * Browsers connect to ws://localhost:3001/?duel=<id> (session cookie
 * required). Server actions in the Next.js app publish events with
 * `pg_notify('duel_events', ...)`; this process LISTENs on that channel
 * and fans each event out to every socket in the duel's room.
 *
 * Run: npm run dev (alongside next dev) or `npx tsx ws-server.ts`.
 */
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, gt } from "drizzle-orm";
import { sessions } from "./lib/schema";
import type { DuelEvent } from "./lib/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://duels:duels@127.0.0.1:5433/duels";
const PORT = Number(process.env.WS_PORT ?? 3001);
const SESSION_COOKIE = "duels_session";

const pool = new Pool({ connectionString: DATABASE_URL });
const orm = drizzle(pool);
const rooms = new Map<string, Set<WebSocket>>();

const sha256 = (s: string) =>
  crypto.createHash("sha256").update(s).digest("hex");

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

async function userIdFromCookies(header: string): Promise<string | null> {
  const token = parseCookie(header, SESSION_COOKIE);
  if (!token) return null;
  const rows = await orm
    .select({ user_id: sessions.user_id })
    .from(sessions)
    .where(
      and(
        eq(sessions.token_hash, sha256(token)),
        gt(sessions.expires_at, new Date())
      )
    );
  return rows[0]?.user_id ?? null;
}

async function main() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("duels ws-server ok\n");
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    try {
      const userId = await userIdFromCookies(req.headers.cookie ?? "");
      const url = new URL(req.url ?? "/", "http://localhost");
      const duelId = url.searchParams.get("duel");
      if (!userId || !duelId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        let room = rooms.get(duelId);
        if (!room) rooms.set(duelId, (room = new Set()));
        room.add(ws);
        ws.on("close", () => {
          room!.delete(ws);
          if (room!.size === 0) rooms.delete(duelId);
        });
      });
    } catch (err) {
      console.error("upgrade failed:", err);
      socket.destroy();
    }
  });

  // Dedicated connection for LISTEN (pool connections can't hold LISTEN).
  const listener = new Client({ connectionString: DATABASE_URL });
  await listener.connect();
  await listener.query("listen duel_events");
  listener.on("notification", (msg) => {
    if (!msg.payload) return;
    let event: DuelEvent;
    try {
      event = JSON.parse(msg.payload);
    } catch {
      return;
    }
    const room = rooms.get(event.duelId);
    if (!room) return;
    for (const ws of room) {
      if (ws.readyState === ws.OPEN) ws.send(msg.payload);
    }
  });
  listener.on("error", (err) => {
    console.error("listener connection error:", err);
    process.exit(1); // let the process manager / dev script restart us
  });

  server.listen(PORT, () =>
    console.log(`⚔️  duels ws-server listening on ws://localhost:${PORT}`)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
