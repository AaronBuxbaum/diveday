import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { capabilityExpiryFor, seatAddressIsLeadTyped } from "@/lib/booking-capabilities";
import {
  bookingLinkToken,
  deploymentKeyring,
  parseVerifiedCapabilityToken,
} from "@/lib/booking-link-token";
import { DAY_MS, HOUR_MS, nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { isTransactionExecutor } from "./query-helpers";
import { bookingCapabilities, bookings, people, shops, trips } from "./schema";
import { seatNotCancelled } from "./trips-queries";

/**
 * **Booking links: one live row per booking, purpose and audience, and a token
 * computed from it** (ADR 20261104-derived-booking-link-tokens, issue #2711).
 *
 * A link is `c<v>.<id>.<tag>` (`src/lib/booking-link-token.ts`): the row's id
 * and an HMAC over it, its key version and its purpose. Nothing secret is
 * stored, so issuing is get-or-create: every email, reminder, page render and
 * "Send the link" for the same booking, purpose and `delivered` hands out the
 * same URL, and retiring a leaked link is one act, revoking its row.
 *
 * **Every lookup from a presented token goes through
 * `parseVerifiedCapabilityToken` first** and then requires the row's
 * `purpose` and `key_version` to match (`rowMatchingToken`). A real id under a
 * wrong tag is refused before any query. `booking-capability-door.test.ts`
 * refuses an `eq(bookingCapabilities.id, …)` anywhere else.
 */

export type CapabilityPurpose = "readiness" | "confirm" | "claim" | "handoff" | "course_forms";

export type IssuedCapability = { token: string; expiresAt: Date };

/** The browser may return from hosted checkout before this one-use receipt expires. */
export const RETURNING_DIVER_RECEIPT_TTL_MS = 24 * HOUR_MS;
export const RETURNING_DIVER_MEMORY_MS = 30 * DAY_MS;
export const RETURNING_DIVER_RECEIPT_LOCK_TIMEOUT = "250ms";
export const RETURNING_DIVER_RECEIPT_STATEMENT_TIMEOUT = "400ms";

export type IssuedReturningDiverReceipt = {
  receiptId: string;
  receiptOrder: string;
  memoryExpiresAt: number;
};

/**
 * **The booking's live link for this purpose, or a new one.** Refuses a
 * booking that isn't this shop's, is cancelled, or whose person is erased: a
 * cancelled booking never gets a link, and its outstanding ones already fail
 * closed at verify time.
 *
 * Get-or-create, under a lock on the person and then the booking (the order
 * erasure takes, so a mint either precedes erasure and is revoked by it, or
 * follows it and sees no subject). The live row is handed back with its expiry
 * moved to what the trip asks for today, so a rescheduled departure carries
 * its links with it, and never less than a day out, so no send carries a
 * link that dies on arrival and a resend never closes the link a diver holds.
 * A row past its expiry, or one not under this deployment's signing key, is
 * revoked and replaced. A `handoff` is never
 * reused: each call revokes the last one and mints anew, because re-arming a
 * ten-minute credential that pre-fills a diver's details would extend it.
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
        contactTypedByLeadAt: bookings.contactTypedByLeadAt,
        claimedAt: bookings.claimedAt,
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
      (input.expectedTripId && booking.tripId !== input.expectedTripId) ||
      refusesDeliveredLink(input, booking)
    )
      return null;
    const tripBound = capabilityExpiryFor(booking.tripEndsAt, now);
    const expiresAt = input.expiresAt && input.expiresAt < tripBound ? input.expiresAt : tripBound;
    const issued = await getOrCreateLiveLinks(tx, {
      shopId: input.shopId,
      purpose: input.purpose,
      delivered: input.delivered ?? false,
      now,
      seats: [{ bookingId: booking.id, expiresAt }],
    });
    return issued.get(booking.id) ?? null;
  };
  return isTransactionExecutor(db) ? issue(db) : db.transaction(issue);
}

/**
 * **No readiness link goes to a minor's address a party's lead typed** (issue
 * #4003). It would open the minor's release, and that address cannot prove a
 * guardian (`seatAddressIsLeadTyped`): a send to it carries no link. Refused here,
 * under the booking lock, so a reminder, find-my-booking, a reschedule notice
 * or a rescue cannot mint one by a path of its own. A link a page hands over
 * (`delivered: false`, the lead's own party panel) is the lead's, and goes on.
 */
function refusesDeliveredLink(
  input: { purpose: CapabilityPurpose; delivered?: boolean },
  seat: { contactTypedByLeadAt: Date | null; claimedAt: Date | null },
): boolean {
  return input.purpose === "readiness" && input.delivered === true && seatAddressIsLeadTyped(seat);
}

/**
 * The get-or-create every issuing path shares, for bookings the caller has
 * already locked and checked. One select of the live rows, then at most one
 * revoke, one expiry update per distinct target, and one insert.
 *
 * The insert is `ON CONFLICT DO NOTHING` on the live-link index, and a booking
 * it skipped is read back: a concurrent issue that got there first wins, and
 * both callers hand out its token (security review of #2711, finding 9).
 */
async function getOrCreateLiveLinks(
  tx: DbExecutor,
  input: {
    shopId: string;
    purpose: CapabilityPurpose;
    delivered: boolean;
    now: Date;
    seats: ReadonlyArray<{ bookingId: string; expiresAt: Date }>;
  },
): Promise<Map<string, IssuedCapability>> {
  const issued = new Map<string, IssuedCapability>();
  if (input.seats.length === 0) return issued;
  const keyring = deploymentKeyring();
  // Before any write: a misconfigured `BOOKING_LINK_SECRET` fails the send
  // loudly instead of silently signing under another key.
  const signingVersion = keyring.signingVersion();
  const { purpose, delivered, now } = input;
  const bookingIds = input.seats.map((seat) => seat.bookingId);
  const liveScope = and(
    eq(bookingCapabilities.shopId, input.shopId),
    inArray(bookingCapabilities.bookingId, bookingIds),
    eq(bookingCapabilities.purpose, purpose),
    eq(bookingCapabilities.delivered, delivered),
    isNull(bookingCapabilities.revokedAt),
  );
  const live = await tx
    .select({
      id: bookingCapabilities.id,
      bookingId: bookingCapabilities.bookingId,
      keyVersion: bookingCapabilities.keyVersion,
      expiresAt: bookingCapabilities.expiresAt,
    })
    .from(bookingCapabilities)
    .where(liveScope)
    .orderBy(bookingCapabilities.id)
    .for("update");
  const liveByBooking = new Map(live.map((row) => [row.bookingId, row]));

  const retire: string[] = [];
  const moveExpiry = new Map<number, string[]>();
  const mint: Array<{ bookingId: string; expiresAt: Date }> = [];
  for (const seat of input.seats) {
    const row = liveByBooking.get(seat.bookingId);
    const reusable =
      row &&
      purpose !== "handoff" &&
      // Only a row under the signing key is handed out again: re-sending (and
      // extending) an older version would keep it alive after rotation.
      row.keyVersion === signingVersion &&
      // An expired row is never revived: a forwarded old link stays dead.
      row.expiresAt.getTime() > now.getTime();
    if (row && reusable && row.keyVersion !== null) {
      if (row.expiresAt.getTime() !== seat.expiresAt.getTime()) {
        const ids = moveExpiry.get(seat.expiresAt.getTime()) ?? [];
        moveExpiry.set(seat.expiresAt.getTime(), [...ids, row.id]);
      }
      issued.set(seat.bookingId, {
        token: bookingLinkToken({ id: row.id, keyVersion: row.keyVersion, purpose }, keyring),
        expiresAt: seat.expiresAt,
      });
      continue;
    }
    if (row) retire.push(row.id);
    mint.push(seat);
  }

  if (retire.length > 0) {
    await tx
      .update(bookingCapabilities)
      .set({ revokedAt: now })
      .where(and(inArray(bookingCapabilities.id, retire), isNull(bookingCapabilities.revokedAt)));
  }
  for (const [at, ids] of moveExpiry) {
    await tx
      .update(bookingCapabilities)
      .set({ expiresAt: new Date(at) })
      .where(inArray(bookingCapabilities.id, ids));
  }
  if (mint.length === 0) return issued;

  const inserted = await tx
    .insert(bookingCapabilities)
    .values(
      mint.map((seat) => ({
        shopId: input.shopId,
        bookingId: seat.bookingId,
        purpose,
        keyVersion: signingVersion,
        delivered,
        issuedAt: now,
        expiresAt: seat.expiresAt,
      })),
    )
    .onConflictDoNothing({
      target: [
        bookingCapabilities.bookingId,
        bookingCapabilities.purpose,
        bookingCapabilities.delivered,
      ],
      where: sql`"revoked_at" is null and "source_capability_id" is null`,
    })
    .returning({
      id: bookingCapabilities.id,
      bookingId: bookingCapabilities.bookingId,
      expiresAt: bookingCapabilities.expiresAt,
    });
  for (const row of inserted) {
    issued.set(row.bookingId, {
      token: bookingLinkToken({ id: row.id, keyVersion: signingVersion, purpose }, keyring),
      expiresAt: row.expiresAt,
    });
  }
  const raced = mint.filter((seat) => !issued.has(seat.bookingId)).map((seat) => seat.bookingId);
  if (raced.length === 0) return issued;
  const winners = await tx
    .select({
      id: bookingCapabilities.id,
      bookingId: bookingCapabilities.bookingId,
      keyVersion: bookingCapabilities.keyVersion,
      expiresAt: bookingCapabilities.expiresAt,
    })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.shopId, input.shopId),
        inArray(bookingCapabilities.bookingId, raced),
        eq(bookingCapabilities.purpose, purpose),
        eq(bookingCapabilities.delivered, delivered),
        isNull(bookingCapabilities.revokedAt),
      ),
    );
  for (const row of winners) {
    if (row.keyVersion === null || !keyring.keyFor(row.keyVersion)) continue;
    issued.set(row.bookingId, {
      token: bookingLinkToken({ id: row.id, keyVersion: row.keyVersion, purpose }, keyring),
      expiresAt: row.expiresAt,
    });
  }
  return issued;
}

/**
 * **The live link a page may show, read and never written.** The token of
 * the booking's unrevoked, unexpired row for this purpose and audience, or
 * null when there is none. The embed confirmation renders the browser's
 * readiness link through this (security review of #2711, finding 3): an
 * anonymous GET never mints, and a booking whose browser link was revoked
 * simply shows none; the emailed link and "mail me my link" cover the rest.
 */
export async function liveBookingLink(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    purpose: CapabilityPurpose;
    delivered: boolean;
    now?: Date;
  },
): Promise<string | null> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({ id: bookingCapabilities.id, keyVersion: bookingCapabilities.keyVersion })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.shopId, input.shopId),
        eq(bookingCapabilities.bookingId, input.bookingId),
        eq(bookingCapabilities.purpose, input.purpose),
        eq(bookingCapabilities.delivered, input.delivered),
        isNull(bookingCapabilities.revokedAt),
        gt(bookingCapabilities.expiresAt, now),
      ),
    )
    .limit(1);
  const keyring = deploymentKeyring();
  if (!row || row.keyVersion === null || !keyring.keyFor(row.keyVersion)) return null;
  return bookingLinkToken(
    { id: row.id, keyVersion: row.keyVersion, purpose: input.purpose },
    keyring,
  );
}

/**
 * Issue the browser-only proof for an explicitly opted-in booking. The proof
 * is bound to the undelivered readiness capability the booking action will
 * redirect to; the emailed readiness token can never redeem it. No PII is
 * stored in the proof or receipt row.
 */
export async function issueReturningDiverReceipt(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    expectedPersonId: string;
    expectedTripId: string;
    redirectReadinessToken: string;
    deviceToken: string;
    deviceGeneration: string | null;
    now?: Date;
  },
): Promise<IssuedReturningDiverReceipt | null> {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(input.deviceToken)) return null;
  if (
    input.deviceGeneration !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.deviceGeneration)
  )
    return null;
  const now = input.now ?? nowDate();
  const issue = async (tx: DbExecutor) => {
    // This optional path runs after the seat commits. Never let a held person,
    // booking or capability row trap the diver before the success redirect.
    await tx.execute(sql.raw(`set local lock_timeout = '${RETURNING_DIVER_RECEIPT_LOCK_TIMEOUT}'`));
    await tx.execute(
      sql.raw(`set local statement_timeout = '${RETURNING_DIVER_RECEIPT_STATEMENT_TIMEOUT}'`),
    );
    // Match the lock order used by normal capability minting and erasure:
    // person, booking, then capability rows.
    const [person] = await tx
      .select({ id: people.id })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.personId, input.expectedPersonId),
          eq(bookings.tripId, input.expectedTripId),
          seatNotCancelled,
          isNull(bookings.identityUnconfirmedAt),
          isNull(people.anonymizedAt),
          isNull(people.deletedAt),
          isNotNull(people.email),
          ne(people.email, ""),
        ),
      )
      .limit(1)
      .for("update", { of: people });
    if (!person) return null;

    const [booking] = await tx
      .select({ status: bookings.status, tripStatus: trips.status, tripDeletedAt: trips.deletedAt })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.personId, input.expectedPersonId),
          eq(bookings.tripId, input.expectedTripId),
        ),
      )
      .limit(1)
      .for("update", { of: bookings });
    if (
      !booking ||
      booking.status === "cancelled" ||
      booking.tripStatus === "cancelled" ||
      booking.tripDeletedAt
    ) {
      return null;
    }

    const redirect = rowMatchingToken(input.redirectReadinessToken, "readiness");
    if (!redirect) return null;
    const [redirectCapability] = await tx
      .select({ id: bookingCapabilities.id, expiresAt: bookingCapabilities.expiresAt })
      .from(bookingCapabilities)
      .where(
        and(
          redirect,
          eq(bookingCapabilities.shopId, input.shopId),
          eq(bookingCapabilities.bookingId, input.bookingId),
          eq(bookingCapabilities.delivered, false),
          isNull(bookingCapabilities.revokedAt),
          gt(bookingCapabilities.expiresAt, now),
        ),
      )
      .limit(1)
      .for("update");
    if (!redirectCapability) return null;

    const expiresAt = new Date(
      Math.min(
        now.getTime() + RETURNING_DIVER_RECEIPT_TTL_MS,
        redirectCapability.expiresAt.getTime(),
      ),
    );
    const [receipt] = await tx
      .insert(bookingCapabilities)
      .values({
        shopId: input.shopId,
        bookingId: input.bookingId,
        purpose: "returning_diver_receipt",
        returningDeviceHash: hashBearerToken(input.deviceToken),
        returningDeviceGeneration: input.deviceGeneration,
        sourceCapabilityId: redirectCapability.id,
        issuedAt: now,
        expiresAt,
        delivered: false,
      })
      .returning({ id: bookingCapabilities.id, order: bookingCapabilities.returningOrder });
    if (receipt) {
      await tx
        .update(bookingCapabilities)
        .set({ revokedAt: now })
        .where(
          and(
            eq(bookingCapabilities.returningDeviceHash, hashBearerToken(input.deviceToken)),
            eq(bookingCapabilities.shopId, input.shopId),
            eq(bookingCapabilities.purpose, "returning_diver_receipt"),
            lte(bookingCapabilities.returningOrder, receipt.order),
            ne(bookingCapabilities.id, receipt.id),
            isNull(bookingCapabilities.revokedAt),
          ),
        );
    }
    return receipt
      ? {
          receiptId: receipt.id,
          receiptOrder: receipt.order.toString(),
          memoryExpiresAt: now.getTime() + RETURNING_DIVER_MEMORY_MS,
        }
      : null;
  };
  return isTransactionExecutor(db) ? issue(db) : db.transaction(issue);
}

/** Resolve an unacknowledged receipt without consuming it, for retry after navigation or a lost response. */
export async function readReturningDiverReceipt(
  db: DbExecutor,
  input: {
    deviceToken: string;
    deviceGeneration: string | null;
    expectedShopId: string;
    now?: Date;
  },
): Promise<{
  receiptId: string;
  receiptOrder: string;
  deviceGeneration: string | null;
  shopSlug: string;
  diver: { fullName: string; email: string };
  memoryExpiresAt: number;
} | null> {
  const now = input.now ?? nowDate();
  const resolve = async (tx: DbExecutor) => {
    const deviceHash = hashBearerToken(input.deviceToken);
    const [row] = await tx
      .select({
        receiptId: bookingCapabilities.id,
        bookingId: bookingCapabilities.bookingId,
        shopId: bookingCapabilities.shopId,
        sourceId: bookingCapabilities.sourceCapabilityId,
        issuedAt: bookingCapabilities.issuedAt,
        receiptOrder: bookingCapabilities.returningOrder,
        deviceGeneration: bookingCapabilities.returningDeviceGeneration,
        fullName: people.fullName,
        email: people.email,
        personId: people.id,
        shopSlug: shops.slug,
      })
      .from(bookingCapabilities)
      .innerJoin(
        bookings,
        and(
          eq(bookings.id, bookingCapabilities.bookingId),
          eq(bookings.shopId, bookingCapabilities.shopId),
        ),
      )
      .innerJoin(people, eq(people.id, bookings.personId))
      .innerJoin(shops, eq(shops.id, bookingCapabilities.shopId))
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookingCapabilities.returningDeviceHash, deviceHash),
          eq(bookingCapabilities.shopId, input.expectedShopId),
          eq(bookingCapabilities.purpose, "returning_diver_receipt"),
          input.deviceGeneration === null
            ? isNull(bookingCapabilities.returningDeviceGeneration)
            : eq(bookingCapabilities.returningDeviceGeneration, input.deviceGeneration),
          isNull(bookingCapabilities.revokedAt),
          gt(bookingCapabilities.expiresAt, now),
          seatNotCancelled,
          isNull(bookings.identityUnconfirmedAt),
          isNull(people.anonymizedAt),
          isNull(people.deletedAt),
          isNotNull(people.email),
          ne(people.email, ""),
          ne(trips.status, "cancelled"),
          isNull(trips.deletedAt),
        ),
      )
      .orderBy(desc(bookingCapabilities.returningOrder))
      .limit(1)
      .for("update", { of: people });
    if (!row?.sourceId || !row.email) return null;

    // Match the cancellation and erasure lock order, then recheck mutable
    // booking/trip state before releasing the lead identity to the browser.
    const [booking] = await tx
      .select({ status: bookings.status, tripStatus: trips.status, tripDeletedAt: trips.deletedAt })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(and(eq(bookings.id, row.bookingId), eq(bookings.shopId, row.shopId)))
      .limit(1)
      .for("update", { of: bookings });
    if (
      !booking ||
      booking.status === "cancelled" ||
      booking.tripStatus === "cancelled" ||
      booking.tripDeletedAt
    )
      return null;

    const [source] = await tx
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.id, row.sourceId),
          eq(bookingCapabilities.bookingId, row.bookingId),
          eq(bookingCapabilities.shopId, row.shopId),
          eq(bookingCapabilities.purpose, "readiness"),
          eq(bookingCapabilities.delivered, false),
          isNull(bookingCapabilities.revokedAt),
          gt(bookingCapabilities.expiresAt, now),
        ),
      )
      .limit(1)
      .for("update");
    const [receipt] = await tx
      .select({
        id: bookingCapabilities.id,
        issuedAt: bookingCapabilities.issuedAt,
        returningOrder: bookingCapabilities.returningOrder,
        returningDeviceGeneration: bookingCapabilities.returningDeviceGeneration,
      })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.id, row.receiptId),
          eq(bookingCapabilities.returningDeviceHash, deviceHash),
          eq(bookingCapabilities.bookingId, row.bookingId),
          eq(bookingCapabilities.shopId, row.shopId),
          eq(bookingCapabilities.purpose, "returning_diver_receipt"),
          eq(bookingCapabilities.sourceCapabilityId, row.sourceId),
          input.deviceGeneration === null
            ? isNull(bookingCapabilities.returningDeviceGeneration)
            : eq(bookingCapabilities.returningDeviceGeneration, input.deviceGeneration),
          isNull(bookingCapabilities.revokedAt),
          gt(bookingCapabilities.expiresAt, now),
        ),
      )
      .limit(1)
      .for("update");
    if (!source || !receipt) return null;
    return {
      receiptId: receipt.id,
      receiptOrder: receipt.returningOrder.toString(),
      deviceGeneration: receipt.returningDeviceGeneration,
      shopSlug: row.shopSlug,
      diver: { fullName: row.fullName, email: row.email },
      memoryExpiresAt: receipt.issuedAt.getTime() + RETURNING_DIVER_MEMORY_MS,
    };
  };
  return isTransactionExecutor(db) ? resolve(db) : db.transaction(resolve);
}

/** Acknowledge storage only after the browser confirms localStorage succeeded. */
export async function acknowledgeReturningDiverReceipt(
  db: DbExecutor,
  input: {
    deviceToken: string;
    expectedReceiptId: string;
    deviceGeneration: string | null;
    expectedShopId: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? nowDate();
  const deviceHash = hashBearerToken(input.deviceToken);
  const [receipt] = await db
    .select({
      id: bookingCapabilities.id,
      shopId: bookingCapabilities.shopId,
      order: bookingCapabilities.returningOrder,
      revokedAt: bookingCapabilities.revokedAt,
    })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.returningDeviceHash, deviceHash),
        eq(bookingCapabilities.id, input.expectedReceiptId),
        eq(bookingCapabilities.shopId, input.expectedShopId),
        eq(bookingCapabilities.purpose, "returning_diver_receipt"),
        input.deviceGeneration === null
          ? isNull(bookingCapabilities.returningDeviceGeneration)
          : eq(bookingCapabilities.returningDeviceGeneration, input.deviceGeneration),
        gt(bookingCapabilities.expiresAt, now),
      ),
    )
    .limit(1);
  if (!receipt) return false;
  if (receipt.revokedAt) return true; // idempotent after a lost acknowledgement response
  const latest = await readReturningDiverReceipt(db, {
    deviceToken: input.deviceToken,
    deviceGeneration: input.deviceGeneration,
    expectedShopId: input.expectedShopId,
    now,
  });
  if (latest?.receiptId !== receipt.id) return false;
  await db
    .update(bookingCapabilities)
    .set({ revokedAt: now })
    .where(
      and(
        eq(bookingCapabilities.returningDeviceHash, deviceHash),
        eq(bookingCapabilities.shopId, receipt.shopId),
        eq(bookingCapabilities.purpose, "returning_diver_receipt"),
        lte(bookingCapabilities.returningOrder, receipt.order),
        isNull(bookingCapabilities.revokedAt),
        gt(bookingCapabilities.expiresAt, now),
      ),
    );
  return true;
}

/** Revoke only the receipt currently held by this device for its cleared shop. */
export async function revokeReturningDiverReceipt(
  db: DbExecutor,
  input: {
    deviceToken: string;
    expectedShopId: string;
    previousDeviceGeneration: string | null;
    nextDeviceGeneration: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? nowDate();
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(input.deviceToken)) return false;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.nextDeviceGeneration,
    )
  )
    return false;
  const deviceHash = hashBearerToken(input.deviceToken);
  const revoked = await db
    .update(bookingCapabilities)
    .set({ revokedAt: now, returningDeviceGeneration: input.nextDeviceGeneration })
    .where(
      and(
        eq(bookingCapabilities.returningDeviceHash, deviceHash),
        eq(bookingCapabilities.shopId, input.expectedShopId),
        eq(bookingCapabilities.purpose, "returning_diver_receipt"),
        input.previousDeviceGeneration === null
          ? isNull(bookingCapabilities.returningDeviceGeneration)
          : eq(bookingCapabilities.returningDeviceGeneration, input.previousDeviceGeneration),
        isNull(bookingCapabilities.revokedAt),
      ),
    )
    .returning({ id: bookingCapabilities.id });
  return revoked.length > 0;
}

/**
 * **One link for each of many bookings, in a fixed number of statements**
 * (code review 2026-10-13, item 35): the departure note's fan-out used to mint
 * one link per seat inside its send loop, three statements a seat, before the
 * first message left. Same rules as {@link issueBookingCapability}, applied to
 * the set: a booking that isn't this shop's or is cancelled gets nothing (it is
 * simply absent from the answer), and each booking's live link is reused.
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
        seatNotCancelled,
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
 * **The issuing half of {@link issueBookingCapabilities}, for a caller that has
 * already read its bookings** (#2488): the organizer's party panel reads every
 * seat with its departure in one statement, so asking the database again which
 * of them exist and when their boats return was a round trip spent learning
 * what the caller held.
 *
 * The bookings are still locked, person rows first then bookings, and
 * re-checked under the lock (not cancelled, subject unchanged) before the
 * get-or-create, so a batch racing an erasure or a single issue stays in the
 * lock order both take.
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
    const requested = [...new Map(input.seats.map((seat) => [seat.bookingId, seat])).values()];
    if (requested.length === 0) return new Map<string, IssuedCapability>();
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
          seatNotCancelled,
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
        contactTypedByLeadAt: bookings.contactTypedByLeadAt,
        claimedAt: bookings.claimedAt,
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
    const current = new Map(lockedBookings.map((row) => [row.bookingId, row]));
    const seats = requested.flatMap((seat) => {
      const locked = current.get(seat.bookingId);
      const expected = input.expectedPersonIds?.get(seat.bookingId);
      const expectedTripId = input.expectedTripIds?.get(seat.bookingId);
      const lockedPerson = eligible.find(({ bookingId }) => bookingId === seat.bookingId)?.personId;
      const ok =
        locked &&
        locked.status !== "cancelled" &&
        locked.personId === lockedPerson &&
        (!expected || locked.personId === expected) &&
        (!expectedTripId || locked.tripId === expectedTripId) &&
        !refusesDeliveredLink(input, locked);
      return ok
        ? [
            {
              bookingId: seat.bookingId,
              expiresAt: capabilityExpiryFor(locked.tripEndsAt, input.now),
            },
          ]
        : [];
    });
    return getOrCreateLiveLinks(tx, {
      shopId: input.shopId,
      purpose: input.purpose,
      delivered: input.delivered ?? false,
      now: input.now,
      seats,
    });
  };
  return isTransactionExecutor(db) ? issue(db) : db.transaction(issue);
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
 * Every other check stays as strict as `verifyBookingCapability`: the tag
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
  const matches = rowMatchingToken(input.token, input.purpose);
  if (!matches) return null;
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
      and(matches, isNull(bookingCapabilities.revokedAt), gt(bookingCapabilities.expiresAt, now)),
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
 * tag must verify and match a real, correctly-scoped, unexpired
 * capability row for the right purpose — the same guessing-resistance bar as
 * `verifyBookingCapability` — so this can't be used to fabricate a
 * cancellation notice for a booking the bearer never had a real link to.
 */
export async function resolveRevokedBookingCapability(
  db: DbExecutor,
  input: { token: string; purpose: CapabilityPurpose; now?: Date },
): Promise<{ bookingId: string } | null> {
  const now = input.now ?? nowDate();
  const matches = rowMatchingToken(input.token, input.purpose);
  if (!matches) return null;
  const [row] = await db
    .select({ bookingId: bookingCapabilities.bookingId })
    .from(bookingCapabilities)
    .where(and(matches, gt(bookingCapabilities.expiresAt, now)))
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
 * The guessing-resistance bar is unchanged: the tag must verify against a
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
  const matches = rowMatchingToken(input.token, input.purpose);
  if (!matches) return null;
  const [row] = await db
    // **`shopId` and nothing else, deliberately.** A `bookingId` here would sit
    // one line from `resolveRevokedBookingCapability`'s, which callers *do* use
    // to key booking reads — and this token is expired, so the same shape would
    // be an invitation to read a booking through one. The type is the guard
    // (`security-reviewer`, on issue #801).
    .select({ shopId: bookingCapabilities.shopId })
    .from(bookingCapabilities)
    .where(matches)
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
  const matches = rowMatchingToken(token, "readiness");
  if (!matches) return null;
  const [row] = await db
    .select({
      shopId: bookingCapabilities.shopId,
      bookingId: bookingCapabilities.bookingId,
    })
    .from(bookingCapabilities)
    .where(
      and(
        matches,
        or(isNotNull(bookingCapabilities.revokedAt), lte(bookingCapabilities.expiresAt, now)),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Does this booking already hold a **delivered** readiness link somebody could
 * be using — the one its emails carry?
 *
 * The guard that stops a *dead* URL driving a delivery on the live one. Same
 * shape and same argument as `hasLivePersonWaiverRequest` on the waiver side;
 * a seat's dead waiver link asks this one too (`emailFreshWaiverLink`).
 *
 * **Delivered only** (security review of #2711, finding 1). The browser's
 * undelivered link is the booking form's, not the diver's inbox: a booking
 * whose emailed link died while the browser's lived on used to answer
 * `current_link_live` here and mail nothing, which left the diver with no link
 * in their mail and no way to get one.
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
export async function hasLiveDeliveredReadinessLink(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({ id: bookingCapabilities.id })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.shopId, input.shopId),
        eq(bookingCapabilities.bookingId, input.bookingId),
        eq(bookingCapabilities.purpose, "readiness"),
        eq(bookingCapabilities.delivered, true),
        isNull(bookingCapabilities.revokedAt),
        gt(bookingCapabilities.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * **Spend a one-use link** (the booking handoff): revoke the live row the
 * token names, scoped to the shop. Idempotent — consuming twice, or a token
 * that never verified, changes nothing.
 */
export async function consumeBookingCapability(
  db: DbExecutor,
  input: { shopId: string; token: string; purpose: CapabilityPurpose; now?: Date },
): Promise<void> {
  const matches = rowMatchingToken(input.token, input.purpose);
  if (!matches) return;
  await db
    .update(bookingCapabilities)
    .set({ revokedAt: input.now ?? nowDate() })
    .where(
      and(
        matches,
        eq(bookingCapabilities.shopId, input.shopId),
        isNull(bookingCapabilities.revokedAt),
      ),
    );
}

/**
 * **Hold the row a presented link names, for a signature that rests on it**
 * (`course-forms.ts`): share-locks the booking's row whose token this is,
 * under any of `purposes`, so a revoke cannot land between the check and the
 * write. False when the token names no row of this booking and shop.
 */
export async function lockBookingCapabilityForToken(
  tx: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    token: string;
    purposes: readonly CapabilityPurpose[];
  },
): Promise<boolean> {
  const matches = input.purposes.flatMap((purpose) => {
    const match = rowMatchingToken(input.token, purpose);
    return match ? [match] : [];
  });
  if (matches.length === 0) return false;
  const [bearer] = await tx
    .select({ id: bookingCapabilities.id })
    .from(bookingCapabilities)
    .where(
      and(
        or(...matches),
        eq(bookingCapabilities.shopId, input.shopId),
        eq(bookingCapabilities.bookingId, input.bookingId),
      ),
    )
    .limit(1)
    .for("share");
  return Boolean(bearer);
}

/**
 * **The one way from a presented token to a row**: the tag is checked first
 * (`parseVerifiedCapabilityToken`, no query), and the row must carry the
 * token's purpose and key version as well as its id. Null means refuse, and
 * every caller returns before touching the database (security review of
 * #2711, finding 5).
 */
function rowMatchingToken(token: string, purpose: CapabilityPurpose) {
  const parsed = parseVerifiedCapabilityToken(token, purpose);
  if (!parsed) return null;
  return and(
    eq(bookingCapabilities.id, parsed.id),
    eq(bookingCapabilities.purpose, purpose),
    eq(bookingCapabilities.keyVersion, parsed.version),
  );
}

/**
 * **A departure's live links follow its end** (issue #2711, code security
 * review finding 4). Called in the transaction that saves a trip's new
 * `endsAt`, or that moves one seat to another departure: every live link of
 * those seats moves to the expiry issuing would give it now, so a boat moved earlier leaves no link outliving it and one
 * moved later keeps its confirmation alive. A handoff keeps its ten minutes
 * and a receipt its own window, so neither moves.
 */
export async function realignTripLinkExpiry(
  tx: DbExecutor,
  input: { shopId: string; endsAt: Date; now?: Date } & (
    | { tripId: string; bookingId?: never }
    | { bookingId: string; tripId?: never }
  ),
): Promise<void> {
  const expiresAt = capabilityExpiryFor(input.endsAt, input.now ?? nowDate());
  await tx
    .update(bookingCapabilities)
    .set({ expiresAt })
    .where(
      and(
        eq(bookingCapabilities.shopId, input.shopId),
        isNull(bookingCapabilities.revokedAt),
        isNull(bookingCapabilities.sourceCapabilityId),
        ne(bookingCapabilities.purpose, "handoff"),
        input.bookingId !== undefined
          ? eq(bookingCapabilities.bookingId, input.bookingId)
          : inArray(
              bookingCapabilities.bookingId,
              tx
                .select({ id: bookings.id })
                .from(bookings)
                .where(and(eq(bookings.tripId, input.tripId), eq(bookings.shopId, input.shopId))),
            ),
      ),
    );
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
    .set({ revokedAt: now })
    .where(and(...conditions));
}

/**
 * **Revoke every link this person's contact on file was sent** (#3902). A
 * delivered link went to the email or phone the person row held at the time;
 * when staff change either (a typo corrected), the old address must not keep
 * a live link to the diver's bookings. The next send mints a fresh row to the
 * new address (`issueBookingCapability` never reuses a revoked one).
 *
 * Two kinds of row went to the address:
 *  - a **delivered** row of any purpose. An undelivered readiness link is the
 *    one the booking browser was handed; it is not about the address and stays.
 *  - a **`course_forms`** row, delivered or not (#3950). The waiver send mints
 *    the forms link undelivered, because the same row is the one a staffer
 *    copies or the counter QR shows, and then mails or texts it to the
 *    contact on file. It signs the course's own release as the student, so it
 *    goes; a staffer at the counter shows a fresh QR.
 */
export async function revokeBookingLinksSentToPerson(
  db: DbExecutor,
  input: { shopId: string; personId: string; now?: Date },
): Promise<void> {
  await db
    .update(bookingCapabilities)
    .set({ revokedAt: input.now ?? nowDate() })
    .where(
      and(
        eq(bookingCapabilities.shopId, input.shopId),
        or(
          eq(bookingCapabilities.delivered, true),
          eq(bookingCapabilities.purpose, "course_forms"),
        ),
        isNull(bookingCapabilities.revokedAt),
        inArray(
          bookingCapabilities.bookingId,
          db
            .select({ id: bookings.id })
            .from(bookings)
            .where(and(eq(bookings.shopId, input.shopId), eq(bookings.personId, input.personId))),
        ),
      ),
    );
}
