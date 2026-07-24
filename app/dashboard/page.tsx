import Link from "next/link";
import { and, desc, eq, getTableColumns, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { duels, users } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { createDuel, joinDuel, logout } from "@/app/actions";
import { dayNumber, localDateStr } from "@/lib/duels";

const cu = alias(users, "cu");
const ou = alias(users, "ou");
const duelRow = {
  ...getTableColumns(duels),
  creator_username: cu.username,
  opponent_username: ou.username,
};

export default async function Dashboard() {
  const user = await requireUser();
  const d = await db();

  const baseQuery = () =>
    d
      .select(duelRow)
      .from(duels)
      .innerJoin(cu, eq(cu.id, duels.creator))
      .leftJoin(ou, eq(ou.id, duels.opponent));

  const [mine, open] = await Promise.all([
    baseQuery()
      .where(or(eq(duels.creator, user.id), eq(duels.opponent, user.id)))
      .orderBy(desc(duels.created_at)),
    baseQuery()
      .where(and(eq(duels.status, "open"), ne(duels.creator, user.id)))
      .orderBy(desc(duels.created_at))
      .limit(20),
  ]);

  const today = localDateStr();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/dashboard" className="text-2xl font-black tracking-tight">
          ⚔️ DUELS
        </Link>
        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <span>@{user.username}</span>
          <form action={logout}>
            <button className="rounded-lg border border-zinc-700 px-3 py-1 hover:bg-zinc-800">
              Log out
            </button>
          </form>
        </div>
      </header>

      {/* Create a duel */}
      <section className="mb-10 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="mb-1 text-lg font-bold">Throw down a challenge</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Post your goal. The duel starts the day a rival accepts it.
        </p>
        <form action={createDuel} className="flex flex-col gap-3 sm:flex-row">
          <input
            name="goal"
            required
            minLength={3}
            maxLength={200}
            placeholder="e.g. Gym every day, 10k steps, no junk food…"
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-red-500"
          />
          <select
            name="days"
            defaultValue="30"
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3"
          >
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
          <button className="rounded-xl bg-red-600 px-6 py-3 font-bold hover:bg-red-500">
            Post it
          </button>
        </form>
      </section>

      {/* My duels */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-bold">Your duels</h2>
        {mine.length === 0 && (
          <p className="text-sm text-zinc-500">
            No duels yet. Post a challenge above or accept one below.
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {mine.map((d) => {
            const rival =
              d.creator === user.id ? d.opponent_username : d.creator_username;
            return (
              <li key={d.id}>
                <Link
                  href={`/duel/${d.id}`}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 hover:border-zinc-600"
                >
                  <div>
                    <p className="font-semibold">{d.goal}</p>
                    <p className="text-sm text-zinc-500">
                      {d.status === "open" && "Waiting for a rival…"}
                      {d.status === "active" &&
                        `vs @${rival} — day ${dayNumber(d, today)} of ${d.days}`}
                      {d.status === "finished" &&
                        (d.is_draw
                          ? `vs @${rival} — draw`
                          : d.winner === user.id
                            ? `vs @${rival} — you won 🏆`
                            : `vs @${rival} — you lost 💀`)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase ${
                      d.status === "active"
                        ? "bg-red-950 text-red-300"
                        : d.status === "open"
                          ? "bg-amber-950 text-amber-300"
                          : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {d.status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Open challenges */}
      <section>
        <h2 className="mb-3 text-lg font-bold">Open challenges</h2>
        {open.length === 0 && (
          <p className="text-sm text-zinc-500">
            Nothing to accept right now. Post one and let a rival find you.
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {open.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4"
            >
              <div>
                <p className="font-semibold">{d.goal}</p>
                <p className="text-sm text-zinc-500">
                  @{d.creator_username} · {d.days} days
                </p>
              </div>
              <form action={joinDuel.bind(null, d.id)}>
                <button className="shrink-0 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold hover:bg-red-500">
                  Accept ⚔️
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
