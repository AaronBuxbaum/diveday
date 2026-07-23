import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth.config";

/**
 * A diver's post-trip recap page needs the same kind of link the readiness page
 * uses — unguessable, stable, revocation-free — but the two must never be
 * interchangeable: a readiness link (which exposes prep state) must not double
 * as a recap link and vice versa. Both are stateless signed tokens over the
 * booking id, domain-separated by a purpose prefix folded into the signed
 * payload, so a token minted for one page fails verification on the other.
 */

const RECAP_PURPOSE = "recap:";

function recapSecret(): string {
  // In production Auth.js refuses to boot without AUTH_SECRET; this is only ever
  // null in dev/e2e where auth.config.ts supplies a fixed fallback. Fail loud
  // rather than sign with an empty key.
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign recap links.");
  return authSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", recapSecret()).update(payload).digest("base64url");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<base64url("recap:"+bookingId)>.<sig>` — opaque, stable, and self-verifying. */
export function signRecapToken(bookingId: string): string {
  const payload = Buffer.from(`${RECAP_PURPOSE}${bookingId}`, "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the booking id iff the signature and recap purpose match; null otherwise. */
export function verifyRecapToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);
  // Length-guard before timingSafeEqual, which throws on unequal buffers.
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  if (!decoded.startsWith(RECAP_PURPOSE)) return null;
  const bookingId = decoded.slice(RECAP_PURPOSE.length);
  return UUID_RE.test(bookingId) ? bookingId : null;
}

/** The absolute-path recap link for a booking, ready to hand to a diver. */
export function recapLinkPath(bookingId: string): string {
  return `/recap/${signRecapToken(bookingId)}`;
}
