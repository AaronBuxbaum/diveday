import { randomBytes } from "node:crypto";
import { DAY_MS, nowMs } from "@/lib/clock";
import { authSecret } from "./auth-secret";
import { deriveLabelKey, signPayload, tagMatches } from "./signed-token";

/**
 * **Which demo shop this browser is sitting in, when no session says so.**
 *
 * The demo banner's role switcher (`switchDemoRoleAction`) is handed a shop
 * slug by the browser, and a demo slug is three dictionary words — roughly
 * 38,000 of them. A staff switch therefore has to be made by somebody already
 * in that shop. A staff session says so on its own; the diver preview does
 * not, because it signs the session out to show the public pages as a diver
 * sees them. Its way back to the staff view is this seat: an httpOnly cookie
 * carrying an HMAC over the shop id, set when a visitor enters a demo or
 * previews it as a diver. Nobody can mint one for a shop they were never in.
 *
 * The key is HKDF-derived from `authSecret` under its own label, so a seat is
 * never interchangeable with a recap link or a session.
 *
 * **Each seat is its own, and it runs out** (security review 2026-10-13): the
 * value is `<nonce>.<expires-at ms>.<HMAC over shop, nonce and expiry>`. A seat
 * over the shop id alone was the same value for every visitor to that shop and
 * was good until the reaper took the shop, so a copy lifted off a shared device
 * was owner access for a week. A day covers the diver preview's round trip.
 */

export const DEMO_SEAT_COOKIE = "diveday_demo_seat";

/** How long a seat is good for; the cookie carries the same age. */
const DEMO_SEAT_LIFETIME_MS = DAY_MS;
export const DEMO_SEAT_MAX_AGE_SECONDS = DEMO_SEAT_LIFETIME_MS / 1000;

const PURPOSE = "demo-seat:";
const SEAT = /^([A-Za-z0-9_-]{22})\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/;

function seatKey(): Buffer {
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign a demo seat.");
  return deriveLabelKey(authSecret, "diveday-demo-seat");
}

function seatSignature(shopId: string, nonce: string, expiresAt: number): string {
  return signPayload(seatKey(), `${PURPOSE}${shopId}.${nonce}.${expiresAt}`);
}

/** A fresh cookie value naming `shopId` as this browser's demo shop, good for a day. */
export function signDemoSeat(shopId: string, now: number = nowMs()): string {
  const nonce = randomBytes(16).toString("base64url");
  const expiresAt = now + DEMO_SEAT_LIFETIME_MS;
  return `${nonce}.${expiresAt}.${seatSignature(shopId, nonce, expiresAt)}`;
}

/** True only for an unexpired seat signed for exactly `shopId`. */
export function isDemoSeatFor(
  value: string | undefined,
  shopId: string,
  now: number = nowMs(),
): boolean {
  const seat = value ? SEAT.exec(value) : null;
  if (!seat) return false;
  const [, nonce, expiry, signature] = seat;
  const expiresAt = Number(expiry);
  if (!(expiresAt > now)) return false;
  return tagMatches(signature, seatSignature(shopId, nonce, expiresAt));
}
