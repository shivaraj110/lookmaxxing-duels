import { notFound } from "next/navigation";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import * as t from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { maybeResolveDuel } from "@/lib/resolve";
import { localDateStr, playerState } from "@/lib/duels";
import DuelRoom from "./DuelRoom";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DuelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const user = await requireUser();
  const d = await db();

  const duelRows = await d.select().from(t.duels).where(eq(t.duels.id, id));
  if (!duelRows[0]) notFound();
  let duel = duelRows[0];

  const [checkins, messages, players] = await Promise.all([
    d
      .select()
      .from(t.checkins)
      .where(eq(t.checkins.duel_id, id))
      .orderBy(desc(t.checkins.day)),
    d
      .select()
      .from(t.messages)
      .where(eq(t.messages.duel_id, id))
      .orderBy(asc(t.messages.created_at))
      .limit(200),
    d
      .select({ id: t.users.id, username: t.users.username })
      .from(t.users)
      .where(
        inArray(
          t.users.id,
          [duel.creator, duel.opponent].filter(Boolean) as string[]
        )
      ),
  ]);

  // Settle missed days / rejections / completed duels lazily on load.
  duel = await maybeResolveDuel(duel, checkins);

  const today = localDateStr();
  const states = duel.opponent
    ? {
        [duel.creator]: playerState(duel, checkins, duel.creator, today),
        [duel.opponent]: playerState(duel, checkins, duel.opponent, today),
      }
    : {};

  return (
    <DuelRoom
      duel={duel}
      checkins={checkins}
      messages={messages}
      players={players.map(({ id, username }) => ({ id, username }))}
      states={states}
      meId={user.id}
      today={today}
    />
  );
}
