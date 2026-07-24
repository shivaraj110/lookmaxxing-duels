# ⚔️ DUELS — Accountability Duels

Stake your streak against a rival with the same goal. Daily photo check-ins,
verified by your opponent. Miss a day — or get a check-in rejected — and your
streak dies. Last streak standing wins.

## Stack

- **Next.js 16** (App Router, Server Actions) + Tailwind
- **PostgreSQL + Drizzle ORM** (`drizzle-orm` on the node-postgres driver) —
  plain Docker container locally, any hosted Postgres in production
- **Realtime** via **Redis pub/sub** + a **separate WebSocket service**
  (its own repo: [`../duels-ws-server`](../duels-ws-server)). This app publishes
  events to Redis; the ws-server subscribes and pushes them live to every
  browser watching that duel. The ws-server holds **no DB credentials** — it
  authenticates each socket with a short-lived HMAC-signed ticket this app
  mints (`GET /api/ws-ticket`) after checking the session. Split out so the
  web app can run on Vercel while the long-lived socket process runs on a
  small always-on host.
- **Email + password auth** — scrypt-hashed passwords, 30-day sessions in
  Postgres; unknown emails become accounts on first login
- **Photo storage** on [UploadThing](https://uploadthing.com) — check-in
  photos are uploaded server-side via `UTApi` and the CDN URL is stored on
  the check-in row

## Local development

Requires Docker Desktop running.

```bash
npm install
docker compose up -d      # Postgres on port 5433 + Redis on 6380
npm run dev               # Next.js on :3000
```

For realtime (check-in/chat push), also run the WebSocket service in the
sibling repo — it shares this app's Redis (6380) and `WS_TICKET_SECRET`:

```bash
cd ../duels-ws-server && npm install && cp .env.example .env
# set WS_TICKET_SECRET in .env to match this app, then:
npm run dev               # ws://localhost:3001
```

`.env.local` is already set up for this compose file — except
`UPLOADTHING_TOKEN`: create a free app at
[uploadthing.com/dashboard](https://uploadthing.com/dashboard) and paste its
token there (check-ins need it; everything else works without).

Drizzle migrations in
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
   Next.js (Vercel)                          ws-server (VPS/Fly/…)
        │  publish                              subscribe │
        └──────────▶  Redis pub/sub (duel_events)  ◀──────┘
        ▲                                                 │
Browser │ 1. GET /api/ws-ticket (session → signed ticket) │
        │ 2. WebSocket ?ticket=…  ────────────────────────┤ verify HMAC (no DB)
        └──────────── 3. broadcast to duel room ──────────┘
```

- The web app and the ws-server are **separate deployables** (this repo →
  Vercel; [`../duels-ws-server`](../duels-ws-server) → an always-on host). They
  share only a Redis instance and the `WS_TICKET_SECRET`.
- The ws-server holds **no DB credentials**. It authenticates each socket by
  verifying an HMAC-signed ticket (shared `WS_TICKET_SECRET`); this app is the
  only side that touches the session store, when minting the ticket.
- Server actions publish events to Redis; the ws-server subscribes once and
  routes each event to the right duel room by `duelId`.
- Chat messages ride inside the event payload for instant delivery; other
  events just tell clients to refetch.

## Deploying before Jul 31

**Web app → Vercel.** Import the repo and set env vars: `DATABASE_URL`
(hosted Postgres — Neon/Supabase/RDS), `REDIS_URL` (a Redis reachable by both
Vercel and the ws-server — e.g. Upstash `rediss://…`), `WS_TICKET_SECRET`,
`UPLOADTHING_TOKEN`, `NEXT_PUBLIC_SITE_URL`, and `NEXT_PUBLIC_WS_URL` (the
ws-server's public origin, `wss://…`).

**ws-server → an always-on host** (VPS / Fly / Railway). See
[`../duels-ws-server`](../duels-ws-server); it needs only `REDIS_URL` and
`WS_TICKET_SECRET` (the same values), no `DATABASE_URL`.

Photos live on UploadThing's CDN — nothing to persist on either host.
