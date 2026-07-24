import type { InferSelectModel } from "drizzle-orm";
import type { checkins, duels, messages, users } from "./schema";

/** User without the password hash — the only shape that leaves the server. */
export type User = Omit<InferSelectModel<typeof users>, "password_hash">;
export type Duel = InferSelectModel<typeof duels>;
export type Checkin = InferSelectModel<typeof checkins>;
export type Message = InferSelectModel<typeof messages>;

export type DuelStatus = Duel["status"];
export type CheckinStatus = Checkin["status"];

export type PlayerState = {
  streak: number;
  brokenOn: string | null;
  checkedInToday: boolean;
};

/** Event fanned out over Postgres NOTIFY → WebSocket server → duel rooms. */
export type DuelEvent = {
  duelId: string;
  kind: "duel" | "checkin" | "message";
  message?: Message & { username: string };
};
