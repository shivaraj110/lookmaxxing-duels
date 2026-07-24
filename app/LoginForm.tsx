"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Something went wrong.");
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center outline-none focus:border-red-500"
      />
      <input
        type="password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password (8+ characters)"
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center outline-none focus:border-red-500"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full rounded-xl bg-red-600 px-4 py-3 font-bold hover:bg-red-500 disabled:opacity-50 transition-colors"
      >
        {status === "sending" ? "Entering…" : "Enter the arena"}
      </button>
      {status === "error" && <p className="text-sm text-red-400">{errorMsg}</p>}
    </form>
  );
}
