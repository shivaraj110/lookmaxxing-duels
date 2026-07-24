import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db";
import { sessions, users } from "./schema";
import type { User } from "./types";

export const SESSION_COOKIE = "duels_session";
const SESSION_DAYS = 30;

export const sha256 = (s: string) =>
  crypto.createHash("sha256").update(s).digest("hex");

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), candidate);
}

/**
 * Login-or-signup in one step: unknown email creates an account,
 * known email must match the password.
 */
export async function loginOrRegister(
  email: string,
  password: string
): Promise<{ user: User } | { error: string }> {
  const d = await db();
  const normalized = email.toLowerCase();
  const existing = await d
    .select()
    .from(users)
    .where(eq(users.email, normalized));

  if (existing[0]) {
    if (!verifyPassword(password, existing[0].password_hash))
      return { error: "Wrong password for this email." };
    return { user: toSafeUser(existing[0]) };
  }

  const base =
    normalized.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "") || "duelist";
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? base : `${base}${n}`;
    const rows = await d
      .insert(users)
      .values({
        email: normalized,
        username: candidate,
        password_hash: hashPassword(password),
      })
      .onConflictDoNothing({ target: users.username })
      .returning();
    if (rows[0]) return { user: toSafeUser(rows[0]) };
  }
}

function toSafeUser(row: User & { password_hash?: string }): User {
  const { id, email, username, created_at } = row;
  return { id, email, username, created_at };
}

export async function createSession(
  userId: string
): Promise<{ token: string; expires: Date }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const d = await db();
  await d.insert(sessions).values({
    token_hash: sha256(token),
    user_id: userId,
    expires_at: expires,
  });
  return { token, expires };
}

export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const d = await db();
  const rows = await d
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      created_at: users.created_at,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.user_id))
    .where(
      and(
        eq(sessions.token_hash, sha256(token)),
        gt(sessions.expires_at, new Date())
      )
    );
  return rows[0] ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return user;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const d = await db();
    await d.delete(sessions).where(eq(sessions.token_hash, sha256(token)));
    cookieStore.delete(SESSION_COOKIE);
  }
}
