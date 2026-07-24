"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkIn, sendChat, verifyCheckin } from "@/app/actions";
import { dayNumber } from "@/lib/duels";
import type {
  Checkin,
  Duel,
  DuelEvent,
  Message,
  PlayerState,
} from "@/lib/types";

type ChatMessage = Message & { username?: string };

export default function DuelRoom({
  duel,
  checkins,
  messages,
  players,
  states,
  meId,
  today,
}: {
  duel: Duel;
  checkins: Checkin[];
  messages: Message[];
  players: { id: string; username: string }[];
  states: Record<string, PlayerState>;
  meId: string;
  today: string;
}) {
  const router = useRouter();
  const [chat, setChat] = useState<ChatMessage[]>(messages);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatFormRef = useRef<HTMLFormElement>(null);

  const byId = useMemo(
    () => Object.fromEntries(players.map((p) => [p.id, p])),
    [players]
  );
  const iAmIn = duel.creator === meId || duel.opponent === meId;
  const myState = states[meId];

  // Keep chat in sync when the server component re-renders, preserving any
  // realtime messages the refetch hasn't caught up with yet.
  const [prevMessages, setPrevMessages] = useState(messages);
  if (messages !== prevMessages) {
    setPrevMessages(messages);
    const ids = new Set(messages.map((m) => m.id));
    setChat((prev) => [...messages, ...prev.filter((m) => !ids.has(m.id))]);
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length]);

  // Realtime: connect to the ws-server room for this duel. Chat messages
  // arrive in the event payload; anything else triggers a server refetch.
  // Each connect first fetches a short-lived signed admission ticket from
  // the app (the ws-server has no DB, so it can't check sessions itself).
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = async () => {
      let ticket: string;
      try {
        const res = await fetch(`/api/ws-ticket?duel=${duel.id}`);
        if (!res.ok) throw new Error(String(res.status));
        ticket = (await res.json()).ticket;
      } catch {
        if (!stopped) retry = setTimeout(connect, 2000);
        return;
      }
      if (stopped) return;

      const port = process.env.NEXT_PUBLIC_WS_PORT ?? "3001";
      ws = new WebSocket(
        `ws://${location.hostname}:${port}/?ticket=${encodeURIComponent(ticket)}`
      );
      ws.onmessage = (e) => {
        let event: DuelEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        if (event.kind === "message" && event.message) {
          const m = event.message;
          setChat((prev) =>
            prev.some((x) => x.id === m.id) ? prev : [...prev, m]
          );
        } else {
          router.refresh();
        }
      };
      ws.onclose = () => {
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [duel.id, router]);

  const playerIds = [duel.creator, duel.opponent].filter(Boolean) as string[];

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <Link
          href="/dashboard"
          className="text-sm text-zinc-400 hover:text-white"
        >
          ← Dashboard
        </Link>
        {duel.status === "active" && (
          <span className="rounded-full bg-red-950 px-3 py-1 text-xs font-bold uppercase text-red-300">
            Day {dayNumber(duel, today)} of {duel.days} · LIVE
          </span>
        )}
      </header>

      <h1 className="mb-1 text-3xl font-black tracking-tight">{duel.goal}</h1>
      <p className="mb-6 text-sm text-zinc-500">
        {duel.days}-day duel · started {duel.started_on ?? "—"}
      </p>

      {/* Outcome banner */}
      {duel.status === "finished" && (
        <div className="mb-6 rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-center">
          <p className="text-4xl mb-2">
            {duel.is_draw ? "🤝" : duel.winner === meId ? "🏆" : "💀"}
          </p>
          <p className="text-xl font-bold">
            {duel.is_draw
              ? "Draw — both streaks survived (or died) together."
              : `@${byId[duel.winner!]?.username} wins the duel!`}
          </p>
        </div>
      )}
      {duel.status === "open" && (
        <div className="mb-6 rounded-2xl border border-amber-900 bg-amber-950/30 p-6 text-center text-amber-300">
          Waiting for a rival to accept… share this page to call someone out.
        </div>
      )}

      {/* Head-to-head */}
      {duel.opponent && (
        <div className="mb-8 grid grid-cols-2 gap-4">
          {playerIds.map((pid) => {
            const s = states[pid];
            const p = byId[pid];
            const dead = !!s?.brokenOn;
            return (
              <div
                key={pid}
                className={`rounded-2xl border p-5 text-center ${
                  dead
                    ? "border-zinc-800 bg-zinc-900/30 opacity-60"
                    : "border-red-900/60 bg-zinc-900/60"
                }`}
              >
                <p className="mb-1 truncate font-bold">
                  @{p?.username}
                  {pid === meId && <span className="text-zinc-500"> (you)</span>}
                </p>
                <p className="text-5xl font-black">
                  {dead ? "💀" : `🔥 ${s?.streak ?? 0}`}
                </p>
                <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
                  {dead ? `streak broke ${s.brokenOn}` : "day streak"}
                </p>
                {!dead && duel.status === "active" && (
                  <p className="mt-2 text-xs text-zinc-400">
                    {s?.checkedInToday
                      ? "✅ checked in today"
                      : "⏳ not yet today"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Check-in */}
      {duel.status === "active" && iAmIn && !myState?.brokenOn && (
        <section className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-1 text-lg font-bold">Today&apos;s check-in</h2>
          {myState?.checkedInToday ? (
            <p className="text-sm text-emerald-400">
              Done for today. Come back tomorrow — or trash-talk below.
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-zinc-500">
                Upload photo proof. Your rival verifies it.
              </p>
              <form
                action={checkIn.bind(null, duel.id)}
                className="flex flex-col gap-3 sm:flex-row sm:items-center"
              >
                <input
                  type="file"
                  name="photo"
                  accept="image/*"
                  capture="environment"
                  required
                  className="flex-1 text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-zinc-600"
                />
                <input
                  name="note"
                  maxLength={300}
                  placeholder="Optional note"
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2"
                />
                <button className="rounded-xl bg-red-600 px-6 py-2 font-bold hover:bg-red-500">
                  Submit proof
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {/* Check-in feed */}
      {duel.opponent && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold">Proof feed</h2>
          {checkins.length === 0 && (
            <p className="text-sm text-zinc-500">No check-ins yet.</p>
          )}
          <ul className="grid gap-4 sm:grid-cols-2">
            {checkins.map((c) => {
              const isMine = c.user_id === meId;
              const canJudge = iAmIn && !isMine && c.status === "pending";
              return (
                <li
                  key={c.id}
                  className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.photo_path}
                    alt={`Check-in ${c.day}`}
                    className="aspect-video w-full object-cover"
                  />
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">
                        @{byId[c.user_id]?.username} · {c.day}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                          c.status === "approved"
                            ? "bg-emerald-950 text-emerald-300"
                            : c.status === "rejected"
                              ? "bg-red-950 text-red-300"
                              : "bg-amber-950 text-amber-300"
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                    {c.note && (
                      <p className="mt-1 text-sm text-zinc-400">{c.note}</p>
                    )}
                    {canJudge && (
                      <div className="mt-3 flex gap-2">
                        <form
                          action={verifyCheckin.bind(null, c.id, "approved")}
                          className="flex-1"
                        >
                          <button className="w-full rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold hover:bg-emerald-600">
                            Approve ✅
                          </button>
                        </form>
                        <form
                          action={verifyCheckin.bind(null, c.id, "rejected")}
                          className="flex-1"
                        >
                          <button className="w-full rounded-lg bg-red-800 px-3 py-1.5 text-sm font-bold hover:bg-red-700">
                            Reject ❌
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Trash talk */}
      {duel.opponent && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-3 text-lg font-bold">Trash talk 🗑️</h2>
          <div className="mb-4 flex max-h-64 flex-col gap-2 overflow-y-auto">
            {chat.length === 0 && (
              <p className="text-sm text-zinc-500">
                Silence… someone break the ice.
              </p>
            )}
            {chat.map((m) => (
              <div
                key={m.id}
                className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                  m.user_id === meId
                    ? "self-end bg-red-900/60"
                    : "self-start bg-zinc-800"
                }`}
              >
                <span className="mr-2 font-bold text-zinc-300">
                  @{m.username ?? byId[m.user_id]?.username}
                </span>
                {m.body}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          {iAmIn && (
            <form
              ref={chatFormRef}
              action={async (fd) => {
                chatFormRef.current?.reset();
                await sendChat(duel.id, fd);
              }}
              className="flex gap-2"
            >
              <input
                name="body"
                required
                maxLength={500}
                placeholder="Say it to their face"
                autoComplete="off"
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 outline-none focus:border-red-500"
              />
              <button className="rounded-xl bg-red-600 px-5 py-2 font-bold hover:bg-red-500">
                Send
              </button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
