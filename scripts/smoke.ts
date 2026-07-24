/**
 * End-to-end smoke test for DUELS (Postgres + Drizzle + ws-server stack).
 * Run from the project root: npx tsx scripts/smoke.ts
 */
import { Pool, types } from "pg";
import { WebSocket } from "ws";
import { localDateStr, addDays, playerState, resolveDuel } from "../lib/duels";

// Match the app: date columns as YYYY-MM-DD strings
types.setTypeParser(1082, (v) => v);

const WEB = "http://localhost:3000";
const PASSWORD = "smoke-pass-123";
const pool = new Pool({
  connectionString: "postgres://duels:duels@127.0.0.1:5433/duels",
});

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures++;
    console.error(`  ❌ ${name}`, extra ?? "");
  }
}

async function login(email: string, password = PASSWORD): Promise<string> {
  const res = await fetch(`${WEB}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  check(`POST /api/login (${email})`, res.ok, res.status);
  const session = (res.headers.get("set-cookie") ?? "").match(
    /duels_session=([^;]+)/
  )?.[1];
  check(`login sets session cookie (${email})`, !!session);
  return `duels_session=${session}`;
}

async function main() {
  console.log("1. Pages up");
  const home = await fetch(WEB);
  check("GET / renders landing", home.ok && (await home.text()).includes("DUELS"));
  const dash = await fetch(`${WEB}/dashboard`, { redirect: "manual" });
  check("GET /dashboard unauthenticated redirects", dash.status === 307);

  console.log("2. Email + password auth");
  const cookieA = await login("alice-smoke@test.local"); // signup
  const cookieB = await login("bob-smoke@test.local"); // signup
  await login("alice-smoke@test.local"); // second login, same account

  const wrong = await fetch(`${WEB}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "alice-smoke@test.local",
      password: "wrong-password",
    }),
  });
  check("wrong password rejected (401)", wrong.status === 401);

  const short = await fetch(`${WEB}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "x@test.local", password: "short" }),
  });
  check("short password rejected (400)", short.status === 400);

  const { rows: dupUsers } = await pool.query(
    "select count(*)::int as n from users where email = 'alice-smoke@test.local'"
  );
  check("re-login did not duplicate the account", dupUsers[0].n === 1);

  const dashA = await fetch(`${WEB}/dashboard`, {
    headers: { cookie: cookieA },
  });
  const dashHtml = await dashA.text();
  check(
    "authed /dashboard shows username",
    dashA.ok && dashHtml.includes("alicesmoke"),
    dashA.status
  );

  console.log("3. Duel lifecycle (DB level)");
  const { rows: users } = await pool.query(
    "select * from users where email = any($1) order by email",
    [["alice-smoke@test.local", "bob-smoke@test.local"]]
  );
  check("both users created", users.length === 2);
  check(
    "passwords stored hashed, not plaintext",
    users.every(
      (u) => u.password_hash !== PASSWORD && u.password_hash.includes(":")
    )
  );
  const [alice, bob] = users;

  const today = localDateStr();
  const { rows: duelRows } = await pool.query(
    `insert into duels (goal, days, creator, opponent, status, started_on)
     values ('Gym every day (smoke)', 7, $1, $2, 'active', $3) returning *`,
    [alice.id, bob.id, today]
  );
  const duel = duelRows[0];
  check("active duel created", duel.status === "active");

  const { rows: ciRows } = await pool.query(
    `insert into checkins (duel_id, user_id, day, photo_path)
     values ($1, $2, $3, 'smoke/fake.jpg') returning *`,
    [duel.id, alice.id, today]
  );
  check("check-in inserted pending", ciRows[0].status === "pending");
  check(
    "date columns come back as strings",
    ciRows[0].day === today,
    ciRows[0].day
  );

  const dup = await pool
    .query(
      `insert into checkins (duel_id, user_id, day, photo_path)
       values ($1, $2, $3, 'smoke/fake2.jpg')`,
      [duel.id, alice.id, today]
    )
    .then(() => null)
    .catch((e) => e);
  check("duplicate same-day check-in blocked (23505)", dup?.code === "23505");

  console.log("4. Duel page renders for participant");
  const duelPage = await fetch(`${WEB}/duel/${duel.id}`, {
    headers: { cookie: cookieB },
  });
  const duelHtml = await duelPage.text();
  check(
    "duel page shows goal + both players",
    duelPage.ok &&
      duelHtml.includes("Gym every day (smoke)") &&
      duelHtml.includes("alicesmoke") &&
      duelHtml.includes("bobsmoke"),
    duelPage.status
  );

  console.log("5. Realtime WebSocket");
  const unauth = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://localhost:3001/?duel=${duel.id}`);
    ws.on("unexpected-response", (_r, res) => resolve(res.statusCode === 401));
    ws.on("open", () => resolve(false));
    ws.on("error", () => {});
    setTimeout(() => resolve(false), 4000);
  });
  check("ws rejects connection without session cookie (401)", unauth);

  const gotEvent = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://localhost:3001/?duel=${duel.id}`, {
      headers: { cookie: cookieA },
    });
    const t = setTimeout(() => resolve(false), 6000);
    ws.on("open", () => {
      pool.query("select pg_notify('duel_events', $1)", [
        JSON.stringify({ duelId: duel.id, kind: "checkin" }),
      ]);
    });
    ws.on("message", (data) => {
      const evt = JSON.parse(data.toString());
      clearTimeout(t);
      resolve(evt.kind === "checkin" && evt.duelId === duel.id);
    });
    ws.on("error", () => resolve(false));
  });
  check("authed ws receives LISTEN/NOTIFY broadcast", gotEvent);

  console.log("6. Chat message via NOTIFY payload");
  const gotChat = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://localhost:3001/?duel=${duel.id}`, {
      headers: { cookie: cookieB },
    });
    const t = setTimeout(() => resolve(false), 6000);
    ws.on("open", () => {
      pool.query("select pg_notify('duel_events', $1)", [
        JSON.stringify({
          duelId: duel.id,
          kind: "message",
          message: { id: "m1", body: "you're going down", username: "alice" },
        }),
      ]);
    });
    ws.on("message", (data) => {
      const evt = JSON.parse(data.toString());
      clearTimeout(t);
      resolve(
        evt.kind === "message" && evt.message?.body === "you're going down"
      );
    });
    ws.on("error", () => resolve(false));
  });
  check("chat payload rides through ws", gotChat);

  console.log("7. Streak / resolution logic (pure)");
  const d = duel;
  const cis = [{ ...ciRows[0], status: "approved" }];
  const sa = playerState(d, cis, alice.id, today);
  const sb = playerState(d, cis, bob.id, today);
  check("A streak = 1 after approved check-in", sa.streak === 1, sa);
  check("B streak = 0, unbroken today", sb.streak === 0 && !sb.brokenOn, sb);
  check("no resolution on day 1", resolveDuel(d, cis, today) === null);

  const tomorrow = addDays(today, 1);
  const r1 = resolveDuel(d, cis, tomorrow);
  check(
    "B misses day 1 → A wins next day",
    r1?.status === "finished" && r1?.winner === alice.id,
    r1
  );

  const rejected = [{ ...ciRows[0], status: "rejected" }];
  const r3 = resolveDuel(d, rejected, tomorrow);
  check(
    "both broken same day → draw",
    r3?.status === "finished" && r3?.is_draw === true,
    r3
  );

  const fullRun: unknown[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    fullRun.push({ ...ciRows[0], id: `xa${i}`, day, user_id: alice.id, status: "approved" });
    fullRun.push({ ...ciRows[0], id: `xb${i}`, day, user_id: bob.id, status: "approved" });
  }
  const r4 = resolveDuel(d, fullRun as never, addDays(today, 7));
  check(
    "both survive full duel → shared win/draw",
    r4?.status === "finished" && r4?.is_draw === true,
    r4
  );

  console.log("8. Cleanup");
  await pool.query(
    "delete from duels where creator = any($1) or opponent = any($1)",
    [[alice.id, bob.id]]
  );
  await pool.query("delete from users where email like '%smoke@test.local'");
  console.log("  🧹 done");

  console.log(
    failures === 0 ? "\nALL CHECKS PASSED ✅" : `\n${failures} CHECK(S) FAILED ❌`
  );
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("SMOKE TEST CRASHED:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
