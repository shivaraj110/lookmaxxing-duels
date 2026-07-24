import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { signTicket } from "@/lib/ws-ticket";

// Mints a short-lived signed ticket the browser presents to the ws-server.
// This is the one place session → identity resolution happens (needs the DB);
// the ws-server only verifies the ticket signature.
export async function GET(request: NextRequest) {
  const duelId = request.nextUrl.searchParams.get("duel");
  if (!duelId) {
    return NextResponse.json({ error: "Missing duel." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  return NextResponse.json({ ticket: signTicket(user.id, duelId) });
}
