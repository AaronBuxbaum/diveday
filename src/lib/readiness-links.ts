import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth.config";

/**
 * A diver's readiness page needs a link that is (1) unguessable, (2) stable so
 * staff can re-share it, and (3) revocation-free — it only mirrors the diver's
 * own prep, never mutates anything. That combination is served by a stateless
 * signed token rather than a stored bearer secret like the waiver link: the
 * booking id is signed with the app secret, so any booking's link can be
 * regenerated on demand without a column or a lookup.
 */

function readinessSecret(): string {
  // In production Auth.js already refuses to boot without AUTH_SECRET, so this
  // is only ever null in dev/e2e where auth.config.ts supplies a fixed
  // fallback. Fail loud rather than sign with an empty key.
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign readiness links.");
  return authSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", readinessSecret()).update(payload).digest("base64url");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<base64url(bookingId)>.<sig>` — opaque, stable, and self-verifying. */
export function signReadinessToken(bookingId: string): string {
  const payload = Buffer.from(bookingId, "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the booking id iff the signature matches; null on any tampering. */
export function verifyReadinessToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);
  // Length-guard before timingSafeEqual, which throws on unequal buffers.
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const bookingId = Buffer.from(payload, "base64url").toString("utf8");
  return UUID_RE.test(bookingId) ? bookingId : null;
}

/** The absolute-path readiness link for a booking, ready to hand to a diver. */
export function readinessLinkPath(bookingId: string): string {
  return `/ready/${signReadinessToken(bookingId)}`;
}
