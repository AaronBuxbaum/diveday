import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { DAY_MS } from "@/lib/clock";
import { isUuid } from "@/lib/uuid";
import { authSecret } from "./auth-secret";
import { nowMs } from "./clock";

/**
 * **The giver's own page** (ADR 20260908-one-hand, decision 6, lever W).
 *
 * A gift has two people and they need two different links. The *receiver* gets
 * a `claim` capability — a stored, revocable bearer row, because claiming a
 * seat is a write and claiming it once kills the link. The *giver* gets this:
 * a stateless signed token over the same booking, granting a read of four
 * facts and nothing else (`src/db/gifts.ts`, `giverGiftView`).
 *
 * **It has to outlive the claim**, which is exactly why it is not a capability.
 * `claimSeatRecord` revokes *every* `booking_capabilities` row on the booking
 * the moment the seat changes hands — correctly, since each of them was
 * authority over the placeholder identity. A giver's link minted that way would
 * die at the one moment it becomes useful: the giver opens it to read that Ben
 * claimed the seat.
 *
 * Same construction as `recap-links.ts` and the same reasoning: purpose-prefixed
 * so a token minted here fails verification on `/recap` and vice versa, keyed by
 * HKDF off `authSecret` (or a dedicated `GIFT_LINK_SECRET`) so a session-JWT
 * rotation does not silently kill every outstanding gift, and self-expiring so a
 * forwarded URL does not work forever.
 */

const GIFT_PURPOSE = "gift:";

/**
 * A season. Long enough for the ordinary shape — a birthday present bought in
 * March for a June boat, opened again after the trip for the receipt — and
 * bounded, because this link names a real seat and a real shop.
 */
const GIFT_TOKEN_MAX_AGE_MS = 180 * DAY_MS;

function giftSecret(): string {
  const dedicated = process.env.GIFT_LINK_SECRET;
  if (dedicated) return dedicated;
  // Only ever null in dev/e2e, where auth-secret.ts supplies a fixed fallback.
  // Fail loud rather than sign with an empty key.
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign gift links.");
  const derived = hkdfSync("sha256", authSecret, "", "diveday-gift-link", 32);
  return Buffer.from(derived).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", giftSecret()).update(payload).digest("base64url");
}

/** `<base64url("gift:"+bookingId+":"+issuedAtSeconds)>.<sig>` — opaque, stable, self-verifying. */
export function signGiftToken(bookingId: string): string {
  const issuedAtSeconds = Math.floor(nowMs() / 1000);
  const payload = Buffer.from(`${GIFT_PURPOSE}${bookingId}:${issuedAtSeconds}`, "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

/**
 * The booking id iff the signature matches, the gift purpose matches, and the
 * token is inside its lifetime; null otherwise. Null is the only failure —
 * callers must never tell a bad signature from an expired one.
 */
export function verifyGiftToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);
  // Length-guard before timingSafeEqual, which throws on unequal buffers.
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  if (!decoded.startsWith(GIFT_PURPOSE)) return null;
  const rest = decoded.slice(GIFT_PURPOSE.length);
  // Booking ids are UUIDs and never contain a colon, so the last colon always
  // separates the id from the issued-at seconds appended after it.
  const lastColon = rest.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const bookingId = rest.slice(0, lastColon);
  const issuedAtSeconds = Number(rest.slice(lastColon + 1));
  if (!Number.isFinite(issuedAtSeconds)) return null;
  if (nowMs() - issuedAtSeconds * 1000 > GIFT_TOKEN_MAX_AGE_MS) return null;
  return isUuid(bookingId) ? bookingId : null;
}
