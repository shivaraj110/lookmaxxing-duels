"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkins, duels, messages } from "@/lib/schema";
import { destroySession, requireUser } from "@/lib/auth";
import { publishDuelEvent } from "@/lib/events";
import { localDateStr } from "@/lib/duels";
import type { Duel } from "@/lib/types";

const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

async function getDuel(id: string): Promise<Duel> {
  const d = await db();
  const rows = await d.select().from(duels).where(eq(duels.id, id));
  if (!rows[0]) throw new Error("Duel not found.");
  return rows[0];
}

export async function logout() {
  await destroySession();
  redirect("/");
}

export async function createDuel(formData: FormData) {
  const user = await requireUser();
  const goal = String(formData.get("goal") ?? "").trim();
  const days = Math.min(365, Math.max(3, Number(formData.get("days") ?? 30)));
  if (goal.length < 3) throw new Error("Goal must be at least 3 characters.");

  const d = await db();
  const rows = await d
    .insert(duels)
    .values({ goal, days, creator: user.id })
    .returning({ id: duels.id });

  revalidatePath("/dashboard");
  redirect(`/duel/${rows[0].id}`);
}

export async function joinDuel(duelId: string) {
  const user = await requireUser();
  const duel = await getDuel(duelId);
  if (duel.status !== "open" || duel.opponent)
    throw new Error("Duel is not open.");
  if (duel.creator === user.id) throw new Error("You can't duel yourself.");

  const d = await db();
  const updated = await d
    .update(duels)
    .set({ opponent: user.id, status: "active", started_on: localDateStr() })
    .where(
      and(eq(duels.id, duelId), eq(duels.status, "open"), isNull(duels.opponent))
    )
    .returning({ id: duels.id });
  if (!updated.length) throw new Error("Someone beat you to it.");

  await publishDuelEvent({ duelId, kind: "duel" });

  revalidatePath("/dashboard");
  redirect(`/duel/${duelId}`);
}

export async function checkIn(duelId: string, formData: FormData) {
  const user = await requireUser();
  const duel = await getDuel(duelId);
  if (duel.status !== "active") throw new Error("Duel is not active.");
  if (duel.creator !== user.id && duel.opponent !== user.id)
    throw new Error("You are not in this duel.");

  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0)
    throw new Error("A proof photo is required.");
  if (photo.size > 10 * 1024 * 1024)
    throw new Error("Photo too large (10MB max).");

  const note = String(formData.get("note") ?? "").slice(0, 300);
  const today = localDateStr();
  const ext = (photo.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const relPath = `${duelId}/${user.id}/${today}.${ext || "jpg"}`;

  const absPath = path.join(UPLOADS_DIR, relPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, Buffer.from(await photo.arrayBuffer()));

  const d = await db();
  try {
    await d.insert(checkins).values({
      duel_id: duelId,
      user_id: user.id,
      day: today,
      photo_path: relPath,
      note,
    });
  } catch (err) {
    if (pgCode(err) === "23505")
      throw new Error("You already checked in today.");
    throw err;
  }

  await publishDuelEvent({ duelId, kind: "checkin" });

  revalidatePath(`/duel/${duelId}`);
}

export async function verifyCheckin(
  checkinId: string,
  verdict: "approved" | "rejected"
) {
  const user = await requireUser();
  const d = await db();
  const rows = await d.select().from(checkins).where(eq(checkins.id, checkinId));
  const checkin = rows[0];
  if (!checkin) throw new Error("Check-in not found.");
  const duel = await getDuel(checkin.duel_id);

  if (checkin.status !== "pending") throw new Error("Already verified.");
  if (checkin.user_id === user.id)
    throw new Error("You can't verify your own check-in.");
  if (duel.creator !== user.id && duel.opponent !== user.id)
    throw new Error("You are not in this duel.");

  const updated = await d
    .update(checkins)
    .set({ status: verdict })
    .where(and(eq(checkins.id, checkinId), eq(checkins.status, "pending")))
    .returning({ id: checkins.id });
  if (!updated.length) throw new Error("Already verified.");

  await publishDuelEvent({ duelId: duel.id, kind: "checkin" });

  revalidatePath(`/duel/${duel.id}`);
}

export async function sendChat(duelId: string, formData: FormData) {
  const user = await requireUser();
  const body = String(formData.get("body") ?? "")
    .trim()
    .slice(0, 500);
  if (!body) return;

  const duel = await getDuel(duelId);
  if (duel.creator !== user.id && duel.opponent !== user.id)
    throw new Error("You are not in this duel.");

  const d = await db();
  const rows = await d
    .insert(messages)
    .values({ duel_id: duelId, user_id: user.id, body })
    .returning();

  await publishDuelEvent({
    duelId,
    kind: "message",
    message: { ...rows[0], username: user.username },
  });
}
