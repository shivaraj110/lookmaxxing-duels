import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Column keys deliberately mirror the snake_case DB names so query results
// line up with the wire types shared with client components.

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  token_hash: text("token_hash").primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const duels = pgTable(
  "duels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goal: text("goal").notNull(),
    days: integer("days").notNull().default(30),
    creator: uuid("creator")
      .notNull()
      .references(() => users.id),
    opponent: uuid("opponent").references(() => users.id),
    status: text("status")
      .$type<"open" | "active" | "finished">()
      .notNull()
      .default("open"),
    winner: uuid("winner").references(() => users.id),
    is_draw: boolean("is_draw").notNull().default(false),
    started_on: date("started_on", { mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("duels_status_idx").on(t.status)]
);

export const checkins = pgTable(
  "checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    duel_id: uuid("duel_id")
      .notNull()
      .references(() => duels.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day", { mode: "string" }).notNull(),
    photo_path: text("photo_path").notNull(),
    note: text("note").notNull().default(""),
    status: text("status")
      .$type<"pending" | "approved" | "rejected">()
      .notNull()
      .default("pending"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("checkins_duel_user_day_uq").on(t.duel_id, t.user_id, t.day),
    index("checkins_duel_idx").on(t.duel_id, t.day),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    duel_id: uuid("duel_id")
      .notNull()
      .references(() => duels.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("messages_duel_idx").on(t.duel_id, t.created_at)]
);
