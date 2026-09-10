import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { isUuid } from "@/lib/uuid";
import { authSecret } from "./auth-secret";
import { isBuddyReferralIdShape } from "./buddy-links";

/**
 * **The signing half of the buddy seat** (ADR 20260908-one-hand, decision 6,
 * lever W) — Node only, because `src/proxy.ts` runs at the edge and the shape
 * check it needs lives in `./buddy-links.ts` beside the cookie.
 *
 * **Non-secret, and it has to be**: the id is printed in a recap a diver
 * forwards to a friend, pasted into a group chat, and read by whoever the
 * friend shows it to. So it authorizes nothing — resolving one credits a seat
 * to a booking, and that is the whole of what holding it buys.
 *
 * **Signed anyway, and stateless.** Signed because an unsigned id would be a
 * bare booking UUID in a shared URL: anyone could hand a booking id back and
 * learn from a shop's own count whether it exists, and a caller could credit a
 * seat to a booking nobody linked from. Stateless because the alternative is a
 * table whose only job is to map a short string to a row it already knows.
 *
 * **The booking id is packed into it beside the tag, and that is a deliberate
 * trade** (security review of this slice, finding 6). A forwarded recap link
 * therefore makes one booking id public. Nothing public accepts a bare booking
 * id — every capability page takes a token that has to verify, and no read
 * anywhere is keyed on an id a caller supplies — so what a reader learns is
 * that some booking exists, which the link in their hand already told them. The
 * alternative is a stored short-code table whose only job is to map a string
 * back to the row the id already names.
 *
 * Same construction and the same purpose separation as `recap-links.ts` and
 * `gift-links.ts`; unlike both it carries **no issued-at and never expires** —
 * "the diver who brought them" is a fact about a seat rather than a credential
 * with a useful life, and a link that quietly stopped counting would look
 * identical to one nobody used.
 */

const BUDDY_PURPOSE = "buddy:";

/** How much of the HMAC rides in the id. 16 base64url characters is 96 bits. */
const TAG_LENGTH = 16;

function buddySecret(): string {
  const dedicated = process.env.BUDDY_LINK_SECRET;
  if (dedicated) return dedicated;
  // Only ever null in dev/e2e, where auth-secret.ts supplies a fixed fallback.
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign buddy links.");
  const derived = hkdfSync("sha256", authSecret, "", "diveday-buddy-link", 32);
  return Buffer.from(derived).toString("base64url");
}

function tagFor(bookingId: string): string {
  return createHmac("sha256", buddySecret())
    .update(`${BUDDY_PURPOSE}${bookingId}`)
    .digest("base64url")
    .slice(0, TAG_LENGTH);
}

/** The public id for a booking: `<uuid bytes, base64url>.<tag>` — 22 + 1 + 16 characters. */
export function buddyReferralId(bookingId: string): string {
  const packed = Buffer.from(bookingId.replaceAll("-", ""), "hex").toString("base64url");
  return `${packed}.${tagFor(bookingId)}`;
}

/**
 * The booking id this referral names, or null for anything else — a hand-typed
 * string, a truncated paste, a tag that does not match. Junk is ignored rather
 * than refused: a friend who mangles the link still books a seat, it is simply
 * credited to nobody.
 */
export function bookingIdFromBuddyReferral(candidate: string | null | undefined): string | null {
  // Shape first, so nothing unbounded or off-charset ever reaches the hash.
  if (!isBuddyReferralIdShape(candidate)) return null;
  const value = candidate as string;
  const dot = value.indexOf(".");
  const packed = value.slice(0, dot);
  const tag = value.slice(dot + 1);
  const bytes = Buffer.from(packed, "base64url");
  if (bytes.length !== 16) return null;
  const hex = bytes.toString("hex");
  const bookingId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!isUuid(bookingId)) return null;
  // Both lengths are fixed by the shape check, so the buffers always compare;
  // timingSafeEqual still, for the reason every other token here uses it.
  if (!timingSafeEqual(Buffer.from(tag), Buffer.from(tagFor(bookingId)))) return null;
  return bookingId;
}
