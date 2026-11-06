import { DAY_MS } from "@/lib/clock";
import { isUuid } from "@/lib/uuid";
import { authSecret } from "./auth-secret";
import { nowMs } from "./clock";
import { deriveLabelKey, signPayload, tagMatches } from "./signed-token";

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
 *
 * **Revocable by epoch** (issue #3982): the payload also carries the booking's
 * `recap_link_epoch`, and the link opens only while the booking still holds
 * that number (`openRecapLink`, `src/db/recap-links.ts`, the one door every
 * recap surface reads through). Correcting the diver's email or phone bumps
 * it, so a link mailed to the old address opens nothing.
 */

const RECAP_PURPOSE = "recap:";
/** A diver revisiting a season later should still find their recap working. */
export const RECAP_TOKEN_MAX_AGE_MS = 180 * DAY_MS;

function recapSecret(): string {
  const dedicated = process.env.RECAP_LINK_SECRET;
  if (dedicated) return dedicated;
  // In production Auth.js refuses to boot without AUTH_SECRET; this is only ever
  // null in dev/e2e where auth-secret.ts supplies a fixed fallback. Fail loud
  // rather than sign with an empty key.
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign recap links.");
  return deriveLabelKey(authSecret, "diveday-recap-link").toString("base64url");
}

function sign(payload: string): string {
  return signPayload(recapSecret(), payload);
}

/**
 * `<base64url("recap:"+bookingId+":"+epoch+":"+issuedAtSeconds)>.<sig>`:
 * opaque, self-verifying and self-expiring. `epoch` is the booking's
 * `recap_link_epoch` when the link is minted.
 */
export function signRecapToken(bookingId: string, epoch: number): string {
  const issuedAtSeconds = Math.floor(nowMs() / 1000);
  const payload = Buffer.from(
    `${RECAP_PURPOSE}${bookingId}:${epoch}:${issuedAtSeconds}`,
    "utf8",
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** What a recap token names: its booking and the epoch it was minted at. */
export type RecapTokenClaim = { bookingId: string; epoch: number };

/**
 * The booking and epoch iff the signature matches, the recap purpose matches,
 * and the token is within its lifetime; null otherwise. Whether the epoch is
 * still the booking's is a database question (`openRecapLink`): a caller that
 * opens a recap never reads this alone.
 */
export function verifyRecapToken(token: string): RecapTokenClaim | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!tagMatches(signature, () => sign(payload))) return null;
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  if (!decoded.startsWith(RECAP_PURPOSE)) return null;
  // Booking ids are UUIDs and never contain a colon: exactly three fields.
  const [bookingId, epochText, issuedAtText, ...extra] = decoded
    .slice(RECAP_PURPOSE.length)
    .split(":");
  if (extra.length > 0 || !bookingId || !epochText || !issuedAtText) return null;
  if (!/^\d+$/.test(epochText) || !/^\d+$/.test(issuedAtText)) return null;
  const epoch = Number(epochText);
  const issuedAtSeconds = Number(issuedAtText);
  if (!Number.isSafeInteger(epoch) || !Number.isSafeInteger(issuedAtSeconds)) return null;
  if (nowMs() - issuedAtSeconds * 1000 > RECAP_TOKEN_MAX_AGE_MS) return null;
  return isUuid(bookingId) ? { bookingId, epoch } : null;
}

/** The absolute-path recap link for a booking at its current epoch, ready to hand to a diver. */
export function recapLinkPath(bookingId: string, epoch: number): string {
  return `/recap/${signRecapToken(bookingId, epoch)}`;
}
