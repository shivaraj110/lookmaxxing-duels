import crypto from "node:crypto";

/**
 * Short-lived, HMAC-signed WebSocket admission ticket.
 *
 * The Next.js app (which has DB + session access) mints a ticket after
 * verifying the user's session; the ws-server verifies the signature with
 * the same shared secret — so the ws-server needs no DB credentials to
 * authenticate a socket. The ticket is bound to a single duel and expires
 * quickly (it's only checked at connect time).
 */
const TTL_MS = 60_000;

function secret(): string {
  const s = process.env.WS_TICKET_SECRET;
  if (!s) throw new Error("WS_TICKET_SECRET is not set.");
  return s;
}

const b64url = (b: Buffer) => b.toString("base64url");

export function signTicket(userId: string, duelId: string): string {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ uid: userId, duel: duelId, exp: Date.now() + TTL_MS })
    )
  );
  const sig = b64url(
    crypto.createHmac("sha256", secret()).update(payload).digest()
  );
  return `${payload}.${sig}`;
}

export type TicketClaims = { uid: string; duel: string; exp: number };

/** Verifies signature + expiry; returns the claims, or null if invalid. */
export function verifyTicket(ticket: string): TicketClaims | null {
  const [payload, sig] = ticket.split(".");
  if (!payload || !sig) return null;

  const expected = crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (
    expected.length !== given.length ||
    !crypto.timingSafeEqual(expected, given)
  )
    return null;

  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString()
    ) as TicketClaims;
    if (!claims.uid || !claims.duel || Date.now() > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}
