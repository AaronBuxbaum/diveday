import { and, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import {
  capabilityExpiryFor,
  createCapabilityToken,
  hashCapabilityToken,
} from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { bookingCapabilities, bookings, trips } from "./schema";

export type CapabilityPurpose = "readiness" | "confirm";

export type IssuedCapability = { token: string; expiresAt: Date };

/**
 * How many live capabilities one booking may hold for one purpose at a time.
 *
 * Minting is unavoidably per-request: tokens are stored only as hashes, so an
 * existing row's plaintext can never be re-derived and a page render that needs
 * a link has no choice but to issue one. That made every GET of the booking
 * confirmation and the signed-waiver page mint another `readiness` capability,
 * each now living to trip end + 30 days — an unbounded pile of live credentials
 * for a single booking, every one of them a working link if it ever leaked.
 *
 * So the pile is capped instead of reused: issuing retires the oldest live rows
 * beyond this many, newest kept. Well above what any honest diver accumulates —
 * a booking's confirmation email, its waiver-signed hand-off, and the 7-day and
 * next-day reminders are a handful, not twenty — so the newest links a real
 * person is actually holding never get pulled out from under them, while a
 * forwarded link from thirty page-loads ago stops working.
 */
export const MAX_LIVE_CAPABILITIES_PER_PURPOSE = 20;

/**
 * Mints a fresh, purpose-bound bearer capability over a booking. Refuses a
 * booking that isn't this shop's or is already cancelled — a cancelled
 * booking never gets a new link, and any of its outstanding links already
 * fail closed at verify time regardless.
 *
 * Deliberately does not supersede an earlier still-valid capability for the
 * same booking+purpose: a diver may be holding an earlier email's link and a
 * later reminder's link at once, and both should keep working until they
 * individually expire or are explicitly revoked — up to
 * `MAX_LIVE_CAPABILITIES_PER_PURPOSE`, past which the oldest are revoked so the
 * set of live credentials for one booking stays bounded (see that constant).
 * Oldest-first is the right end to cut: the newest link is the one the person
 * in front of the page is about to follow, and the oldest is the one most
 * likely to have been forwarded, screenshotted, or left in a shared inbox.
 */
export async function issueBookingCapability(
  db: AppDb,
  input: { shopId: string; bookingId: string; purpose: CapabilityPurpose; now?: Date },
): Promise<IssuedCapability | null> {
  const now = input.now ?? nowDate();
  const [booking] = await db
    .select({ id: bookings.id, tripEndsAt: trips.endsAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  if (!booking) return null;

  await retireOldestLiveCapabilities(db, input.shopId, input.bookingId, input.purpose, now);

  const token = createCapabilityToken();
  const expiresAt = capabilityExpiryFor(booking.tripEndsAt, now);
  await db.insert(bookingCapabilities).values({
    shopId: input.shopId,
    bookingId: input.bookingId,
    purpose: input.purpose,
    tokenHash: hashCapabilityToken(token),
    issuedAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Makes room for one more: revokes every live capability for this
 * booking+purpose past the newest `MAX_LIVE_CAPABILITIES_PER_PURPOSE - 1`, so
 * that after the caller's insert the booking holds at most the cap.
 *
 * Revokes rather than deletes. A revoked row is the same "this link isn't
 * available" answer at `verifyBookingCapability` as a missing one, and keeping
 * it means `resolveRevokedBookingCapability` can still show a diver their
 * post-cancellation refund notice, `revokeBookingCapabilities` still walks the
 * whole set on cancellation (it filters on `revokedAt IS NULL`, so an
 * already-retired row is simply left alone), and the audit trail of what was
 * ever issued for a booking survives. Only "live" rows count towards the cap —
 * anything already expired or revoked is inert and needs no retiring.
 */
async function retireOldestLiveCapabilities(
  db: AppDb,
  shopId: string,
  bookingId: string,
  purpose: CapabilityPurpose,
  now: Date,
): Promise<void> {
  const live = await db
    .select({ id: bookingCapabilities.id })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.shopId, shopId),
        eq(bookingCapabilities.bookingId, bookingId),
        eq(bookingCapabilities.purpose, purpose),
        isNull(bookingCapabilities.revokedAt),
        gt(bookingCapabilities.expiresAt, now),
      ),
    )
    // Newest first, with `id` only as a tiebreaker so two rows minted in the
    // same instant still order deterministically.
    .orderBy(desc(bookingCapabilities.issuedAt), desc(bookingCapabilities.id));
  const doomed = live.slice(MAX_LIVE_CAPABILITIES_PER_PURPOSE - 1).map((row) => row.id);
  if (doomed.length === 0) return;
  await db
    .update(bookingCapabilities)
    .set({ revokedAt: now })
    .where(inArray(bookingCapabilities.id, doomed));
}

export type BookingCapabilityContext = {
  bookingId: string;
  shopId: string;
  personId: string;
  tripId: string;
};

/**
 * Resolves a bearer token to its booking context, or null for anything that
 * must read to the caller as "this link isn't available" — unknown token,
 * wrong purpose, expired, revoked, or a since-cancelled booking. Callers
 * must never distinguish these cases in a public response: this function is
 * the one place that decides, so no response elsewhere can leak a
 * booking-existence oracle.
 */
export async function verifyBookingCapability(
  db: DbExecutor,
  input: { token: string; purpose: CapabilityPurpose; now?: Date },
): Promise<BookingCapabilityContext | null> {
  const now = input.now ?? nowDate();
  const tokenHash = hashCapabilityToken(input.token);
  const [row] = await db
    .select({
      bookingId: bookingCapabilities.bookingId,
      capabilityShopId: bookingCapabilities.shopId,
      bookingShopId: bookings.shopId,
      personId: bookings.personId,
      tripId: bookings.tripId,
      bookingStatus: bookings.status,
      tripStatus: trips.status,
    })
    .from(bookingCapabilities)
    .innerJoin(bookings, eq(bookings.id, bookingCapabilities.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookingCapabilities.tokenHash, tokenHash),
        eq(bookingCapabilities.purpose, input.purpose),
        isNull(bookingCapabilities.revokedAt),
        gt(bookingCapabilities.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Fail closed on a since-cancelled booking even though nothing proactively
  // revoked this row, and defend in depth against the capability's shopId
  // ever drifting from its booking's — nothing legitimate can cause that
  // today, but a verified identity must never be trusted past that check.
  if (row.bookingStatus === "cancelled") return null;
  // Trip cancellation doesn't cascade into cancelling its bookings (a
  // separate, pre-existing gap outside this ticket's scope), so a booking
  // can still read "booked" after the trip itself is called off — a
  // security review of CR-002/CR-003 found this let an outstanding
  // capability keep paying/rental-fit/contact authority for a trip that no
  // longer runs. Fail closed here too, the same way `issueWaiverRequest`
  // already does for waivers (src/db/waivers.ts).
  if (row.tripStatus === "cancelled") return null;
  if (row.capabilityShopId !== row.bookingShopId) return null;
  return {
    bookingId: row.bookingId,
    shopId: row.capabilityShopId,
    personId: row.personId,
    tripId: row.tripId,
  };
}

/**
 * Resolves a bearer token to its booking even if the capability has since
 * been revoked — used only to render a post-cancellation confirmation
 * (never to authorize a read or a write): the moment a diver cancels their
 * own booking, `cancelBooking` revokes every outstanding capability for it
 * (including the very token the cancel action is about to redirect back to
 * with a `?cancelled=...` refund notice), so `verifyBookingCapability` alone
 * can never show that notice — it always reads as "this link isn't
 * available" instead, silently dropping the refund information the diver
 * most needs right after cancelling.
 *
 * Safe to relax only the revocation/cancelled-booking checks here: the token
 * hash must still genuinely match a real, correctly-scoped, unexpired
 * capability row for the right purpose — the same guessing-resistance bar as
 * `verifyBookingCapability` — so this can't be used to fabricate a
 * cancellation notice for a booking the bearer never had a real link to.
 */
export async function resolveRevokedBookingCapability(
  db: DbExecutor,
  input: { token: string; purpose: CapabilityPurpose; now?: Date },
): Promise<{ bookingId: string } | null> {
  const now = input.now ?? nowDate();
  const tokenHash = hashCapabilityToken(input.token);
  const [row] = await db
    .select({ bookingId: bookingCapabilities.bookingId })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.tokenHash, tokenHash),
        eq(bookingCapabilities.purpose, input.purpose),
        gt(bookingCapabilities.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Explicit revocation: invalidates every outstanding, unexpired capability
 * for a booking (optionally scoped to one purpose) immediately, ahead of
 * their natural expiry. Used on cancellation; also the seam a future
 * staff-facing "revoke this link" action would call.
 */
export async function revokeBookingCapabilities(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; purpose?: CapabilityPurpose; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  const conditions = [
    eq(bookingCapabilities.shopId, input.shopId),
    eq(bookingCapabilities.bookingId, input.bookingId),
    isNull(bookingCapabilities.revokedAt),
  ];
  if (input.purpose) conditions.push(eq(bookingCapabilities.purpose, input.purpose));
  await db
    .update(bookingCapabilities)
    .set({ revokedAt: now })
    .where(and(...conditions));
}
