import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  capabilityExpiryFor,
  createCapabilityToken,
  hashCapabilityToken,
} from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { openSecret, type SecretKey, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import type { DbExecutor } from "./client";
import { isTransactionExecutor } from "./query-helpers";
import { bookingCapabilities, bookings, people, trips } from "./schema";

export type CapabilityPurpose = "readiness" | "confirm" | "claim" | "handoff" | "course_forms";

export type IssuedCapability = { token: string; expiresAt: Date };

/**
 * How many live capabilities one booking may hold for one purpose at a time.
 *
 * Minting is unavoidably per-request: tokens are stored only as hashes, so an
 * existing row's plaintext can never be re-derived and a page render that needs
 * a link has no choice but to issue one. That made every GET of the booking
 * confirmation mint another `readiness` capability,
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
 * **The two readiness links a new booking gets** (security review r5-4, F1):
 * one for the browser that booked, which proved only a typed name and an
 * address and so stays undelivered, and one for the confirmation email, which
 * is delivered and opens the diver's other days. Issued one after the other,
 * never side by side, so a transaction executor stays sequential.
 */
export async function issueBookedReadinessLinks(
  db: DbExecutor,
  input: { shopId: string; bookingId: string },
): Promise<{ redirect: IssuedCapability | null; mailed: IssuedCapability | null }> {
  const redirect = await issueBookingCapability(db, { ...input, purpose: "readiness" });
  const mailed = await issueBookingCapability(db, {
    ...input,
    purpose: "readiness",
    delivered: true,
  });
  return { redirect, mailed };
}

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
  // `DbExecutor`, so a caller that must decide and write atomically can hand in
  // its transaction — the readiness rescue re-checks its live-link guard under
  // a row lock and issues inside the same one (issue #850).
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    purpose: CapabilityPurpose;
    /** The subject observed by the caller; refuses a booking repointed since that read. */
    expectedPersonId?: string;
    expectedTripId?: string;
    now?: Date;
    /**
     * Keep an openable copy of the token (`token_sealed`), so a later send can
     * hand the same link back — `issueCourseFormsCapability` only.
     */
    sealingKey?: SecretKey | null;
    /**
     * A shorter life than the trip's, for a purpose that is about the next
     * ten minutes rather than the departure — the booking handoff. Never
     * longer: the trip-anchored expiry stays the ceiling.
     */
    expiresAt?: Date;
    /**
     * The token goes only into a message to the contact on file, never back
     * to the browser that asked (`booking_capabilities.delivered`). Leave it
     * off for a link a redirect or a page hands over.
     */
    delivered?: boolean;
  },
): Promise<IssuedCapability | null> {
  const now = input.now ?? nowDate();
  const issue = async (tx: DbExecutor) => {
    const [subject] = await tx
      .select({ personId: people.id, anonymizedAt: people.anonymizedAt })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          ...(input.expectedPersonId ? [eq(bookings.personId, input.expectedPersonId)] : []),
        ),
      )
      .limit(1)
      .for("update", { of: people });
    if (!subject || subject.anonymizedAt) return null;
    const [booking] = await tx
      .select({
        id: bookings.id,
        personId: bookings.personId,
        tripId: bookings.tripId,
        status: bookings.status,
        tripEndsAt: trips.endsAt,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .limit(1)
      .for("update");
    if (
      !booking ||
      booking.personId !== subject.personId ||
      booking.status === "cancelled" ||
      (input.expectedPersonId && booking.personId !== input.expectedPersonId) ||
      (input.expectedTripId && booking.tripId !== input.expectedTripId)
    )
      return null;
    // Erasure locks the person before revoking booking capabilities. Taking
    // the same lock makes mint either precede erasure (and get revoked) or
    // follow it (and see no eligible subject).
    await retireOldestLiveCapabilities(tx, input.shopId, [input.bookingId], input.purpose, now);

    const token = createCapabilityToken();
    const tripBound = capabilityExpiryFor(booking.tripEndsAt, now);
    const expiresAt = input.expiresAt && input.expiresAt < tripBound ? input.expiresAt : tripBound;
    await tx.insert(bookingCapabilities).values({
      shopId: input.shopId,
      bookingId: input.bookingId,
      purpose: input.purpose,
      tokenHash: hashCapabilityToken(token),
      tokenSealed: input.sealingKey ? sealSecret(token, input.sealingKey) : null,
      delivered: input.delivered ?? false,
      issuedAt: now,
      expiresAt,
    });
    return { token, expiresAt };
  };
  return isTransactionExecutor(db) ? issue(db) : db.transaction(issue);
}

/**
 * **One capability for each of many bookings, in a fixed number of statements**
 * (code review 2026-10-13, item 35): the departure note's fan-out used to mint
 * one link per seat inside its send loop, three statements a seat, before the
 * first message left. Same rules as {@link issueBookingCapability}, applied to
 * the set: a booking that isn't this shop's or is cancelled gets nothing (it is
 * simply absent from the answer), and each booking's live set stays within
 * `MAX_LIVE_CAPABILITIES_PER_PURPOSE`, its oldest retired first.
 */
export async function issueBookingCapabilities(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingIds: string[];
    /** Expected current subject per booking, for sends based on an earlier scan. */
    expectedPersonIds?: ReadonlyMap<string, string>;
    expectedTripIds?: ReadonlyMap<string, string>;
    purpose: CapabilityPurpose;
    now?: Date;
    /** As {@link issueBookingCapability}'s: every token goes only into a message. */
    delivered?: boolean;
  },
): Promise<Map<string, IssuedCapability>> {
  const now = input.now ?? nowDate();
  const issued = new Map<string, IssuedCapability>();
  const bookingIds = [...new Set(input.bookingIds)];
  if (bookingIds.length === 0) return issued;
  const found = await db
    .select({ id: bookings.id, tripEndsAt: trips.endsAt, personId: bookings.personId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        inArray(bookings.id, bookingIds),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
        isNull(people.anonymizedAt),
      ),
    );
  if (found.length === 0) return issued;
  return mintBookingCapabilities(db, {
    shopId: input.shopId,
    seats: found.map((booking) => ({ bookingId: booking.id, tripEndsAt: booking.tripEndsAt })),
    expectedPersonIds: input.expectedPersonIds,
    expectedTripIds: input.expectedTripIds,
    purpose: input.purpose,
    now,
    delivered: input.delivered,
  });
}

/**
 * **The minting half of {@link issueBookingCapabilities}, for a caller that has
 * already read its bookings** (#2488): the organizer's party panel reads every
 * seat with its departure in one statement, so asking the database again which
 * of them exist and when their boats return was a round trip spent learning
 * what the caller held.
 *
 * The caller owns the proof that every seat is this shop's and not cancelled,
 * read in the same request: nothing here re-checks it. The rules after that
 * are the same as ever: each booking's live set stays within
 * `MAX_LIVE_CAPABILITIES_PER_PURPOSE`, its oldest retired first, and the
 * retiring finishes before the new rows go in.
 */
export async function mintBookingCapabilities(
  db: DbExecutor,
  input: {
    shopId: string;
    seats: Array<{ bookingId: string; tripEndsAt: Date }>;
    expectedPersonIds?: ReadonlyMap<string, string>;
    expectedTripIds?: ReadonlyMap<string, string>;
    purpose: CapabilityPurpose;
    now: Date;
    /** As {@link issueBookingCapability}'s: every token goes only into a message. */
    delivered?: boolean;
  },
): Promise<Map<string, IssuedCapability>> {
  const issue = async (tx: DbExecutor) => {
    const issued = new Map<string, IssuedCapability>();
    const requested = [...new Map(input.seats.map((seat) => [seat.bookingId, seat])).values()];
    if (requested.length === 0) return issued;
    // Stable person ordering avoids deadlocks when a party spans people and
    // concurrent erasures or capability batches overlap.
    const eligible = await tx
      .select({ bookingId: bookings.id, personId: bookings.personId })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          inArray(
            bookings.id,
            requested.map((seat) => seat.bookingId),
          ),
          eq(bookings.shopId, input.shopId),
          ne(bookings.status, "cancelled"),
          isNull(people.anonymizedAt),
        ),
      )
      .orderBy(people.id)
      .for("update", { of: people });
    const lockedBookings = await tx
      .select({
        bookingId: bookings.id,
        personId: bookings.personId,
        tripId: bookings.tripId,
        tripEndsAt: trips.endsAt,
        status: bookings.status,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          inArray(
            bookings.id,
            eligible.map(({ bookingId }) => bookingId),
          ),
          eq(bookings.shopId, input.shopId),
        ),
      )
      .orderBy(bookings.id)
      .for("update");
    const eligiblePeople = new Map(
      lockedBookings.map(({ bookingId, personId, tripId, tripEndsAt, status }) => [
        bookingId,
        { personId, tripId, tripEndsAt, status },
      ]),
    );
    const seats = requested.filter((seat) => {
      const current = eligiblePeople.get(seat.bookingId);
      const expected = input.expectedPersonIds?.get(seat.bookingId);
      const expectedTripId = input.expectedTripIds?.get(seat.bookingId);
      const lockedPerson = eligible.find(({ bookingId }) => bookingId === seat.bookingId)?.personId;
      return Boolean(
        current &&
          current.status !== "cancelled" &&
          current.personId === lockedPerson &&
          (!expected || current.personId === expected) &&
          (!expectedTripId || current.tripId === expectedTripId),
      );
    });
    if (seats.length === 0) return issued;

    await retireOldestLiveCapabilities(
      tx,
      input.shopId,
      seats.map((seat) => seat.bookingId),
      input.purpose,
      input.now,
    );

    const rows = seats.map((seat) => {
      const token = createCapabilityToken();
      const current = eligiblePeople.get(seat.bookingId);
      if (!current) throw new Error("mintBookingCapabilities: locked booking disappeared");
      const expiresAt = capabilityExpiryFor(current.tripEndsAt, input.now);
      issued.set(seat.bookingId, { token, expiresAt });
      return {
        shopId: input.shopId,
        bookingId: seat.bookingId,
        purpose: input.purpose,
        tokenHash: hashCapabilityToken(token),
        tokenSealed: null,
        delivered: input.delivered ?? false,
        issuedAt: input.now,
        expiresAt,
      };
    });
    await tx.insert(bookingCapabilities).values(rows);
    return issued;
  };
  return isTransactionExecutor(db) ? issue(db) : db.transaction(issue);
}

/**
 * **The course-forms link for one enrollment: the live one when there is one**
 * (ADR 20261008-course-forms). A staffer who emails the forms and then copies
 * the link hands over one URL, not two — the waiver link's rule (ADR
 * 20260820-waiver-links-are-reused-not-reissued), and for its reason: every
 * send minting another live credential is a pile of working links for one
 * booking. A `course_forms` token opens the forms page and nothing else.
 *
 * The live row's token is read back from its sealed copy. With no sealing key
 * there is no readable copy, and this mints as `issueBookingCapability` always
 * has, under the same per-purpose cap. Decided under a lock on the booking row,
 * so two sends at once cannot both mint.
 */
export async function issueCourseFormsCapability(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    now?: Date;
    expectedPersonId?: string;
    expectedTripId?: string;
  },
): Promise<(IssuedCapability & { reused: boolean }) | null> {
  const now = input.now ?? nowDate();
  const keyResult = secretKeyFromEnvironment();
  const sealingKey = keyResult.status === "ok" ? keyResult.key : null;
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({ id: bookings.id, tripId: bookings.tripId })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          ne(bookings.status, "cancelled"),
          isNull(people.anonymizedAt),
          ...(input.expectedPersonId ? [eq(bookings.personId, input.expectedPersonId)] : []),
        ),
      )
      .for("update", { of: people });
    if (!booking || (input.expectedTripId && booking.tripId !== input.expectedTripId)) return null;
    if (sealingKey) {
      const [live] = await tx
        .select({
          tokenSealed: bookingCapabilities.tokenSealed,
          expiresAt: bookingCapabilities.expiresAt,
        })
        .from(bookingCapabilities)
        .where(
          and(
            eq(bookingCapabilities.shopId, input.shopId),
            eq(bookingCapabilities.bookingId, booking.id),
            eq(bookingCapabilities.purpose, "course_forms"),
            isNull(bookingCapabilities.revokedAt),
            gt(bookingCapabilities.expiresAt, now),
            isNotNull(bookingCapabilities.tokenSealed),
          ),
        )
        // diveday:allow-time-id-order: picks the newest live link to hand back; no list renders it.
        .orderBy(desc(bookingCapabilities.issuedAt), desc(bookingCapabilities.id))
        .limit(1);
      const token = live?.tokenSealed ? openSecret(live.tokenSealed, sealingKey) : null;
      if (live && token) return { token, expiresAt: live.expiresAt, reused: true };
    }
    const issued = await issueBookingCapability(tx, {
      shopId: input.shopId,
      bookingId: booking.id,
      purpose: "course_forms",
      expectedPersonId: input.expectedPersonId,
      expectedTripId: input.expectedTripId,
      now,
      sealingKey,
    });
    return issued ? { ...issued, reused: false } : null;
  });
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
  db: DbExecutor,
  shopId: string,
  bookingIds: string[],
  purpose: CapabilityPurpose,
  now: Date,
): Promise<void> {
  const live = await db
    .select({ id: bookingCapabilities.id, bookingId: bookingCapabilities.bookingId })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.shopId, shopId),
        inArray(bookingCapabilities.bookingId, bookingIds),
        eq(bookingCapabilities.purpose, purpose),
        isNull(bookingCapabilities.revokedAt),
        gt(bookingCapabilities.expiresAt, now),
      ),
    )
    // Newest first, with `id` only as a tiebreaker so two rows minted in the
    // same instant still order deterministically.
    // diveday:allow-time-id-order: which surplus capabilities are revoked; no list renders it.
    .orderBy(desc(bookingCapabilities.issuedAt), desc(bookingCapabilities.id));
  // Each booking keeps its own newest `MAX_LIVE_CAPABILITIES_PER_PURPOSE - 1`.
  const keptPerBooking = new Map<string, number>();
  const doomed: string[] = [];
  for (const row of live) {
    const kept = keptPerBooking.get(row.bookingId) ?? 0;
    if (kept >= MAX_LIVE_CAPABILITIES_PER_PURPOSE - 1) doomed.push(row.id);
    else keptPerBooking.set(row.bookingId, kept + 1);
  }
  if (doomed.length === 0) return;
  await db
    .update(bookingCapabilities)
    .set({ revokedAt: now, tokenSealed: null })
    .where(inArray(bookingCapabilities.id, doomed));
}

export type BookingCapabilityContext = {
  bookingId: string;
  shopId: string;
  personId: string;
  tripId: string;
  /** The token reached the bearer only through the contact on file. */
  delivered: boolean;
};

/**
 * Resolves a bearer token to its booking context, or null for anything that
 * must read to the caller as "this link isn't available" — unknown token,
 * wrong purpose, expired, revoked, a since-cancelled booking, or a departure
 * since cancelled or deleted. Callers
 * must never distinguish these cases in a public response: this function is
 * the one place that decides, so no response elsewhere can leak a
 * booking-existence oracle.
 */
export async function verifyBookingCapability(
  db: DbExecutor,
  input: { token: string; purpose: CapabilityPurpose; now?: Date },
): Promise<BookingCapabilityContext | null> {
  const row = await liveCapabilityRow(db, input);
  if (!row) return null;
  // Fail closed on a since-cancelled booking even though nothing proactively
  // revoked this row, and defend in depth against the capability's shopId
  // ever drifting from its booking's — nothing legitimate can cause that
  // today, but a verified identity must never be trusted past that check.
  if (row.bookingStatus === "cancelled") return null;
  if (row.personAnonymized) return null;
  if (row.personMerged) return null;
  // Trip cancellation doesn't cascade into cancelling its bookings (a
  // separate, pre-existing gap outside this ticket's scope), so a booking
  // can still read "booked" after the trip itself is called off — a
  // security review of CR-002/CR-003 found this let an outstanding
  // capability keep paying/rental-fit/contact authority for a trip that no
  // longer runs. Fail closed here too, the same way `issueWaiverRequest`
  // already does for waivers (src/db/waivers.ts).
  if (row.tripStatus === "cancelled") return null;
  // A deleted departure is gone from every staff surface, so a link to it
  // reads as dead too, even while its status still says scheduled (#2926).
  if (row.tripDeleted) return null;
  if (row.capabilityShopId !== row.bookingShopId) return null;
  return {
    bookingId: row.bookingId,
    shopId: row.capabilityShopId,
    personId: row.personId,
    tripId: row.tripId,
    delivered: row.delivered,
  };
}

/**
 * **A live readiness link whose departure was called off, for one ask and
 * nothing else** (UX sheet 2026-10-22, item 5).
 *
 * `verifyBookingCapability` fails closed on a cancelled departure, and must:
 * the link may not keep paying, fitting gear or cancelling for a boat that no
 * longer runs. The diver it stranded may still ask the shop to move them, and
 * this is the only door for that: a second, differently-named function rather
 * than a relaxed flag on the first, so no existing caller can reach it by
 * accident.
 *
 * Every other check stays as strict as `verifyBookingCapability`: the hash
 * matches an unrevoked, unexpired `readiness` capability, the booking is
 * live, the departure is not deleted, and the capability's shop is the
 * booking's. Only the inverse of the one relaxation is required: the
 * departure **is** cancelled, so this never verifies a link the ordinary
 * check would accept. Its one caller files a move ask through
 * `recordMoveAsk`, which writes an Inbox row and moves nothing.
 */
export async function verifyStrandedBookingCapability(
  db: DbExecutor,
  input: { token: string; now?: Date },
): Promise<{ bookingId: string; shopId: string } | null> {
  const row = await liveCapabilityRow(db, { ...input, purpose: "readiness" });
  if (!row) return null;
  if (row.bookingStatus === "cancelled") return null;
  if (row.personAnonymized) return null;
  if (row.personMerged) return null;
  if (row.tripStatus !== "cancelled" || row.tripDeleted) return null;
  if (row.capabilityShopId !== row.bookingShopId) return null;
  return { bookingId: row.bookingId, shopId: row.capabilityShopId };
}

/** The unrevoked, unexpired capability row a token names, with its booking and departure. */
async function liveCapabilityRow(
  db: DbExecutor,
  input: { token: string; purpose: CapabilityPurpose; now?: Date },
) {
  const now = input.now ?? nowDate();
  const tokenHash = hashCapabilityToken(input.token);
  const [row] = await db
    .select({
      bookingId: bookingCapabilities.bookingId,
      capabilityShopId: bookingCapabilities.shopId,
      bookingShopId: bookings.shopId,
      personId: bookings.personId,
      personAnonymized: sql<boolean>`${people.anonymizedAt} is not null`,
      personMerged: isNotNull(people.mergedIntoPersonId),
      tripId: bookings.tripId,
      bookingStatus: bookings.status,
      tripStatus: trips.status,
      tripDeleted: sql<boolean>`${trips.deletedAt} is not null`,
      delivered: bookingCapabilities.delivered,
    })
    .from(bookingCapabilities)
    .innerJoin(bookings, eq(bookings.id, bookingCapabilities.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    // diveday:allow-deleted-trips: both verifiers read `tripDeleted` and refuse a deleted departure.
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
  return row ?? null;
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
 * **Which shop a dead link belonged to, and nothing else.**
 *
 * Expiry *and* revocation relaxed — so unlike `resolveRevokedBookingCapability`
 * above, an aged-out token resolves here too. That is the whole point: `/ready`
 * is the link in the 24-hour trip reminder, and every ordinary way of reaching
 * an expired one (a bookmark from last season, a forwarded email, a reminder
 * for a trip that moved) ended on four words telling the diver to ask a shop
 * the page would not name (issue #801).
 *
 * **What it may be used for is the narrow part.** It authorizes nothing and
 * reads nothing: the caller takes the `shopId` to name the shop and print the
 * contact details that shop already publishes, and stops. It must never gate a
 * read of the booking, the diver, or the trip — the token has expired, and an
 * expired token is not a key.
 *
 * The guessing-resistance bar is unchanged: the hash must genuinely match a
 * capability row that was issued for this purpose. What is relaxed is only
 * *when* it was valid, never *whether* it was ours. The waiver page reached the
 * same conclusion first (`staleWaiverRecordForToken`) and its comments carry
 * the reasoning for the model as a whole: a bearer token reveals only its own
 * record, and a record's shop is part of that record.
 */
export async function staleBookingCapabilityForToken(
  db: DbExecutor,
  input: { token: string; purpose: CapabilityPurpose },
): Promise<{ shopId: string } | null> {
  const tokenHash = hashCapabilityToken(input.token);
  const [row] = await db
    // **`shopId` and nothing else, deliberately.** A `bookingId` here would sit
    // one line from `resolveRevokedBookingCapability`'s, which callers *do* use
    // to key booking reads — and this token is expired, so the same shape would
    // be an invitation to read a booking through one. The type is the guard
    // (`security-reviewer`, on issue #801).
    .select({ shopId: bookingCapabilities.shopId })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.tokenHash, tokenHash),
        eq(bookingCapabilities.purpose, input.purpose),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * **The booking behind a dead readiness link — for the rescue, and nothing
 * else.**
 *
 * `staleBookingCapabilityForToken` above returns `{ shopId }` alone on purpose,
 * and its comment says why: a `bookingId` there would sit one line from
 * `resolveRevokedBookingCapability`'s, which callers *do* use to key booking
 * reads, and this token is expired. That guard is not weakened — this is a
 * second, differently-named door with one caller, rather than a widening of the
 * first.
 *
 * What the caller may do with it is bounded by what it is for (issue #850):
 * key the resend's inbox rate-limit bucket, and hand the booking to
 * `issueBookingCapability`, which re-validates it and refuses a cancelled one.
 * **Nothing read through this may reach a rendered page.** The rescue answers
 * the caller with a bare outcome code — no address, no token, no booking
 * detail — so a bearer of a dead URL can trigger a delivery to its owner and
 * learn nothing.
 *
 * **Dead links only** — expired or revoked, never a live one. That narrowing is
 * `staleWaiverRecordForToken`'s and it is load-bearing rather than tidy: the
 * booking this resolves to keys the resend's per-inbox rate-limit budget, so a
 * resolver that also answered for *live* tokens would let anyone holding any
 * readiness URL for a booking — including one that still works — spend the
 * budget its owner needs to rescue themselves (`security-reviewer`, issue
 * #850). A live token never reaches this page anyway; it renders the diver's
 * actual checklist.
 */
export async function staleReadinessBookingForResend(
  db: DbExecutor,
  token: string,
  now: Date = nowDate(),
): Promise<{ shopId: string; bookingId: string } | null> {
  const [row] = await db
    .select({
      shopId: bookingCapabilities.shopId,
      bookingId: bookingCapabilities.bookingId,
    })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.tokenHash, hashCapabilityToken(token)),
        eq(bookingCapabilities.purpose, "readiness"),
        or(isNotNull(bookingCapabilities.revokedAt), lte(bookingCapabilities.expiresAt, now)),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Does this booking already hold a readiness link somebody could be using?
 *
 * The guard that stops a *dead* URL driving a delivery on the live one. Same
 * shape and same argument as `hasLiveWaiverRequest` on the waiver side.
 *
 * **"Live" here means the row, not the answer `verifyBookingCapability` would
 * give.** Those differ: verification also fails closed on a cancelled booking
 * and a cancelled trip, so on a called-off departure every capability is an
 * unrevoked, unexpired row that does not work. Answering `current_link_live`
 * there told a diver "you already have a link and it still works" about a
 * departure that no longer runs, in success tone, forever — the caller must
 * therefore establish that the booking and its trip are good *before* asking
 * this (`security-reviewer`, issue #850). `emailFreshReadinessLink` does.
 * `sendFindMyBookingLinks` (`find-my-booking.ts`, issue #723) is the other
 * caller — its own query already filters to non-cancelled bookings on
 * scheduled, not-yet-departed trips before this is ever asked.
 */
export async function hasLiveReadinessCapability(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; now?: Date },
): Promise<boolean> {
  return hasLiveCapabilityRow(db, { ...input, purpose: "readiness" });
}

/**
 * One unrevoked, unexpired row for this booking+purpose, or none. Private: what
 * a caller may conclude from "live" differs per purpose, and the exported
 * door above is where that argument is written down.
 */
async function hasLiveCapabilityRow(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; purpose: CapabilityPurpose; now?: Date },
): Promise<boolean> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({ id: bookingCapabilities.id })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.shopId, input.shopId),
        eq(bookingCapabilities.bookingId, input.bookingId),
        eq(bookingCapabilities.purpose, input.purpose),
        isNull(bookingCapabilities.revokedAt),
        gt(bookingCapabilities.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Explicit revocation: stamps `revoked_at` on every capability row for a
 * booking that is not already revoked (optionally scoped to one purpose),
 * immediately, ahead of natural expiry.
 *
 * **Not "unexpired", which is what this said for a slice.** There is no
 * `expires_at > now` condition, so an already-aged-out row is stamped too. No
 * resolver's answer changes either way — `resolveRevokedBookingCapability`
 * requires an unexpired row, `staleBookingCapabilityForToken` relaxes both, and
 * `staleReadinessBookingForResend` matches revoked *or* expired — so this is the
 * docblock catching up with the predicate rather than a behaviour change
 * (security review, 2026-09-12).
 *
 * Unscoped on cancellation — every purpose at once — and scoped to one
 * purpose where a single kind of link is retired. A staff-facing "revoke this
 * link" would call the same function and needs no widening of it.
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
    // A revoked link is dead, so its openable copy has no reason to exist.
    .set({ revokedAt: now, tokenSealed: null })
    .where(and(...conditions));
}

/**
 * **Take back links that were minted ahead of a send that did not go** (#2451).
 * A batch mints every reachable seat's link before the first message leaves,
 * because the link is part of the body; when the provider then answers
 * not-sent (a bounce, a stop-listed phone, a refused request), nobody holds
 * the token, and a live capability for no reader is only surface. This revokes
 * exactly the tokens it is handed — by hash, never by booking — so an earlier,
 * delivered link for the same booking stays live.
 */
export async function revokeIssuedCapabilities(
  db: DbExecutor,
  input: { shopId: string; tokens: readonly string[]; now?: Date },
): Promise<void> {
  if (input.tokens.length === 0) return;
  await db
    .update(bookingCapabilities)
    .set({ revokedAt: input.now ?? nowDate(), tokenSealed: null })
    .where(
      and(
        eq(bookingCapabilities.shopId, input.shopId),
        inArray(bookingCapabilities.tokenHash, input.tokens.map(hashCapabilityToken)),
        isNull(bookingCapabilities.revokedAt),
      ),
    );
}
