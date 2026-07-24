# ⚔️ DUELS — Accountability Duels

Stake your streak against a rival with the same goal. Daily photo check-ins,
verified by your opponent. Miss a day — or get a check-in rejected — and your
streak dies. Last streak standing wins.

## Stack

- **Next.js 16** (App Router, Server Actions) + Tailwind
- **PostgreSQL + Drizzle ORM** (`drizzle-orm` on the node-postgres driver) —
  plain Docker container locally, any hosted Postgres in production
- **Realtime WebSocket server** (`ws-server.ts`) — bridged to the app with
  Postgres `LISTEN/NOTIFY`, so a check-in written by the web app is pushed
  live to every browser watching that duel
- **Email + password auth** — scrypt-hashed passwords, 30-day sessions in
  Postgres; unknown emails become accounts on first login
- **Photo storage** on disk (`data/uploads`), served by a route handler

## Local development

Requires Docker Desktop running.

```bash
npm install
docker compose up -d      # Postgres on port 5433
npm run dev               # Next.js on :3000 + WebSocket server on :3001
```

`.env.local` is already set up for this compose file. Drizzle migrations in
`drizzle/` are applied automatically on the first DB access — no manual
migration step. After editing `lib/schema.ts`, run `npm run db:generate` to
create the next migration (and restart the dev server). `npm run db:studio`
opens Drizzle Studio to browse the data.

### Try it end-to-end

1. Open http://localhost:3000 and log in with any email + password (8+
   chars) — the account is created on the spot.
2. Post a challenge.
3. In a second browser (or incognito window), log in as a different email and
   accept the challenge.
4. Check in with a photo; watch the other browser update live. Verify or
   reject your rival's check-ins. Trash-talk in the chat.

`npx tsx scripts/smoke.ts` runs the full end-to-end verification (auth,
duels, realtime, streak rules) against the running dev servers.

## How the game works

- A duel starts the day a rival accepts it (`started_on`).
- Each player must check in **every day** with photo proof.
- The opponent approves or rejects each check-in. Pending check-ins count
  until rejected.
- A missed past day or a rejected check-in **breaks your streak** — your
  opponent wins. If both break on the same day, it's a draw. Survive the full
  duel length together and you both win.
- Duels are settled lazily whenever a duel page loads (no cron needed).

## Architecture notes

```
Browser ──HTTP──▶ Next.js (server actions write via Drizzle, then pg_notify)
   ▲                                │
   └──────WebSocket◀── ws-server ◀──┘  (LISTEN duel_events → broadcast to room)
```

- `ws-server.ts` authenticates sockets with the same session cookie the app
  sets (cookies are host-scoped, so localhost:3001 receives them).
- Chat messages ride inside the NOTIFY payload for instant delivery; other
  events just tell clients to refetch.

## Deploying before Jul 31

1. Provision a Postgres (Supabase/Neon/RDS — any connection string works)
   and set `DATABASE_URL`.
2. Run the web app (`next start`) and `ws-server.ts` on a host that supports
   long-lived processes (Railway, Fly.io, Render, a VPS). Set
   `NEXT_PUBLIC_SITE_URL` and `WS_PORT`/`NEXT_PUBLIC_WS_PORT`.
3. Photos are written to `UPLOADS_DIR` — mount a persistent volume for it.
