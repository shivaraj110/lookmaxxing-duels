/**
 * Realtime WebSocket server.
 *
 * Browsers connect to ws://localhost:3001/?ticket=<signed-ticket>. The ticket
 * is minted by the Next.js app (GET /api/ws-ticket) after it verifies the
 * user's session, and carries the duel id it grants access to. This server
 * verifies the ticket's HMAC signature with a shared secret — so it needs NO
 * database credentials.
 *
 * Events arrive over Redis pub/sub: server actions in the Next.js app publish
 * to the `duel_events` channel; this process subscribes and fans each event
 * out to every socket in the target duel's room.
 *
 * Run: npm run dev (alongside next dev) or `npx tsx ws-server.ts`.
 */
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import Redis from "ioredis";
import { verifyTicket } from "./lib/ws-ticket";
import { DUEL_CHANNEL } from "./lib/redis";
import type { DuelEvent } from "./lib/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = Number(process.env.WS_PORT ?? 3001);
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6380";

const rooms = new Map<string, Set<WebSocket>>();

async function main() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("duels ws-server ok\n");
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const claims = verifyTicket(url.searchParams.get("ticket") ?? "");
      if (!claims) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const duelId = claims.duel;
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

  // Dedicated subscriber connection (a subscribed Redis client can't run
  // other commands).
  const sub = new Redis(REDIS_URL);
  await sub.subscribe(DUEL_CHANNEL);
  sub.on("message", (_channel, payload) => {
    let event: DuelEvent;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    const room = rooms.get(event.duelId);
    if (!room) return;
    for (const ws of room) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  });
  sub.on("error", (err) => {
    console.error("redis subscriber error:", err);
  });

  server.listen(PORT, () =>
    console.log(`⚔️  duels ws-server listening on ws://localhost:${PORT}`)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
