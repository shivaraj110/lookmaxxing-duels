import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <p className="text-6xl mb-4">⚔️</p>
        <h1 className="text-5xl font-black tracking-tight mb-3">DUELS</h1>
        <p className="text-zinc-400 text-lg mb-2">
          Stake your streak against a rival with the same goal.
        </p>
        <p className="text-zinc-500 text-sm mb-10">
          Daily photo check-ins, verified by your opponent. Miss a day — or get
          a check-in rejected — and your streak dies. Last streak standing
          wins.
        </p>

        <LoginForm />

        <p className="mt-8 text-xs text-zinc-600">
          New email? Your account is created on the spot.
        </p>
      </div>
    </main>
  );
}
