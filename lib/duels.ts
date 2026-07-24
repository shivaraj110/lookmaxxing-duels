import type { Checkin, Duel, PlayerState } from "./types";

export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  return localDateStr(date);
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms =
    new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime();
  return Math.round(ms / 86_400_000);
}

/** Last day of the duel (inclusive). */
export function endDay(duel: Duel): string {
  return addDays(duel.started_on!, duel.days - 1);
}

/** 1-based current day number, clamped to the duel length. */
export function dayNumber(duel: Duel, today: string): number {
  if (!duel.started_on) return 0;
  return Math.min(daysBetween(duel.started_on, today) + 1, duel.days);
}

/**
 * A player's streak stands while every elapsed day has a non-rejected
 * check-in. A missed past day or a rejected check-in breaks it. Pending
 * check-ins count until the opponent rejects them.
 */
export function playerState(
  duel: Duel,
  checkins: Checkin[],
  userId: string,
  today: string
): PlayerState {
  if (!duel.started_on) return { streak: 0, brokenOn: null, checkedInToday: false };

  const mine = new Map(
    checkins.filter((c) => c.user_id === userId).map((c) => [c.day, c])
  );
  const last = endDay(duel) < today ? endDay(duel) : today;
  let streak = 0;
  let brokenOn: string | null = null;

  for (let d = duel.started_on; d <= last; d = addDays(d, 1)) {
    const c = mine.get(d);
    if (c && c.status !== "rejected") {
      streak += 1;
    } else if (c?.status === "rejected" || d < today) {
      // rejected, or a past day with no check-in
      brokenOn = d;
      break;
    }
  }

  return {
    streak: brokenOn ? 0 : streak,
    brokenOn,
    checkedInToday: mine.has(today),
  };
}

export type Resolution = Pick<Duel, "status" | "winner" | "is_draw">;

/** Returns the finished-state update for an active duel, or null if it's still live. */
export function resolveDuel(
  duel: Duel,
  checkins: Checkin[],
  today: string
): Resolution | null {
  if (duel.status !== "active" || !duel.started_on || !duel.opponent) return null;

  const a = playerState(duel, checkins, duel.creator, today);
  const b = playerState(duel, checkins, duel.opponent, today);

  if (a.brokenOn && b.brokenOn) {
    if (a.brokenOn === b.brokenOn)
      return { status: "finished", winner: null, is_draw: true };
    // Whoever survived longer wins.
    return {
      status: "finished",
      winner: a.brokenOn > b.brokenOn ? duel.creator : duel.opponent,
      is_draw: false,
    };
  }
  if (a.brokenOn)
    return { status: "finished", winner: duel.opponent, is_draw: false };
  if (b.brokenOn)
    return { status: "finished", winner: duel.creator, is_draw: false };

  // Both survived the full duel: shared victory.
  if (today > endDay(duel))
    return { status: "finished", winner: null, is_draw: true };

  return null;
}
