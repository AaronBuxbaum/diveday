import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { DAY_MS } from "@/lib/clock";
import { authSecret } from "./auth-secret";

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
 */

export const DEMO_SEAT_COOKIE = "diveday_demo_seat";

/** As long as the reaper keeps a demo shop (ADR 20260724-per-visitor-demo-shops). */
export const DEMO_SEAT_MAX_AGE_SECONDS = (7 * DAY_MS) / 1000;

const PURPOSE = "demo-seat:";
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{43}$/;

function seatKey(): Buffer {
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign a demo seat.");
  return Buffer.from(hkdfSync("sha256", authSecret, "", "diveday-demo-seat", 32));
}

/** The cookie value naming `shopId` as this browser's demo shop. */
export function signDemoSeat(shopId: string): string {
  return createHmac("sha256", seatKey()).update(`${PURPOSE}${shopId}`).digest("base64url");
}

/** True only for a seat signed for exactly `shopId`. */
export function isDemoSeatFor(value: string | undefined, shopId: string): boolean {
  if (!value || !BASE64URL_SIGNATURE.test(value)) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(signDemoSeat(shopId)));
}
