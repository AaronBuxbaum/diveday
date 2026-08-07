import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { DAY_MS } from "@/lib/clock";
import { isUuid } from "@/lib/uuid";
import { authSecret } from "./auth.config";
import { nowMs } from "./clock";

/**
 * A diver's post-trip recap page needs the same kind of link the readiness page
 * uses — unguessable, stable, revocation-free — but the two must never be
 * interchangeable: a readiness link (which exposes prep state) must not double
 * as a recap link and vice versa. Both are stateless signed tokens over the
 * booking id, domain-separated by a purpose prefix folded into the signed
 * payload, so a token minted for one page fails verification on the other.
 *
 * The signing key is purpose-separated from the session-JWT key (HKDF over
 * `authSecret`, or a dedicated `RECAP_LINK_SECRET` when set) and every payload
 * carries its own issued-at time, rejected past `RECAP_TOKEN_MAX_AGE_MS` — so
 * `AUTH_SECRET` can rotate without silently killing every outstanding recap
 * link, and a leaked link doesn't work forever (security review finding,
 * docs/product/archive/specialist-optimization-audit-20260731.md §5).
 */

const RECAP_PURPOSE = "recap:";
/** A diver revisiting a season later should still find their recap working. */
const RECAP_TOKEN_MAX_AGE_MS = 180 * DAY_MS;

function recapSecret(): string {
  const dedicated = process.env.RECAP_LINK_SECRET;
  if (dedicated) return dedicated;
  // In production Auth.js refuses to boot without AUTH_SECRET; this is only ever
  // null in dev/e2e where auth.config.ts supplies a fixed fallback. Fail loud
  // rather than sign with an empty key.
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign recap links.");
  const derived = hkdfSync("sha256", authSecret, "", "diveday-recap-link", 32);
  return Buffer.from(derived).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", recapSecret()).update(payload).digest("base64url");
}

/** `<base64url("recap:"+bookingId+":"+issuedAtSeconds)>.<sig>` — opaque, stable, self-verifying, and self-expiring. */
export function signRecapToken(bookingId: string): string {
  const issuedAtSeconds = Math.floor(nowMs() / 1000);
  const payload = Buffer.from(`${RECAP_PURPOSE}${bookingId}:${issuedAtSeconds}`, "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

/**
 * Returns the booking id iff the signature matches, the recap purpose
 * matches, and the token is within its lifetime; null otherwise.
 */
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
  const rest = decoded.slice(RECAP_PURPOSE.length);
  // Booking ids are UUIDs and never contain a colon, so the last colon always
  // separates the id from the issued-at seconds appended after it.
  const lastColon = rest.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const bookingId = rest.slice(0, lastColon);
  const issuedAtSeconds = Number(rest.slice(lastColon + 1));
  if (!Number.isFinite(issuedAtSeconds)) return null;
  if (nowMs() - issuedAtSeconds * 1000 > RECAP_TOKEN_MAX_AGE_MS) return null;
  return isUuid(bookingId) ? bookingId : null;
}

/** The absolute-path recap link for a booking, ready to hand to a diver. */
export function recapLinkPath(bookingId: string): string {
  return `/recap/${signRecapToken(bookingId)}`;
}
