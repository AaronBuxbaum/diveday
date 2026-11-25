import { and, asc, eq, gt, isNull, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { AppDb, DbExecutor } from "@/db/client";
import { numberedDiveDay } from "@/db/dive-days";
import { boundLockWaits, isLockWaitRefusal } from "@/db/lock-bounds";
import { isNewerMark } from "@/db/roll-call-order";
import { seatMarks } from "@/db/roll-call-subject";
import {
  bookingReferrals,
  bookings,
  people,
  rollCallEvents,
  shops,
  tripCreditEntries,
  trips,
} from "@/db/schema";
import { lockTripCreditPerson, tripCreditBalance } from "@/db/trip-credit-ledger";
import { notRehearsal, seatHeld } from "@/db/trips";
import { rungOffsetMs } from "@/lib/departure-clock";
import { buddyCreditEntryId, validTripCreditAmount } from "@/lib/trip-credit";

/** Referrals one tick may credit; the rest wait an hour. */
export const BUDDY_CREDIT_SWEEP_LIMIT = 200;

export type BuddyCreditSweepSummary = { granted: number; busy: number; skipped: number };

type Candidate = { shopId: string; buddyBookingId: string; referrerPersonId: string };

/**
 * **A friend who booked through a diver's link has dived** (issue #4260, ADR
 * 20261125-buddy-referral-trip-credit): the referrals whose referrer is owed
 * the shop's buddy credit.
 *
 * "Dived" is the shared dive-day rule (`numberedDiveDay`, `src/db/dive-days.ts`)
 * narrowed by everything a credit should not survive: the seat is still held
 * (`no_show` and cancelled earn nothing), the departure is scheduled, real and
 * an hour past its return, and no standing departure roll call says the seat
 * stayed ashore. A shop that set no amount, or switched buddy links off,
 * credits nobody. An erased or removed referrer is left out.
 *
 * Once per friend, not per seat: a friend who came back on the same link
 * three times was brought once (`friendsBroughtBy` counts the same way).
 */
function eligibleReferrals(db: DbExecutor, now: Date, buddyBookingId?: string) {
  const referrer = alias(bookings, "buddy_credit_referrer");
  const referrerPerson = alias(people, "buddy_credit_referrer_person");
  const prior = alias(tripCreditEntries, "buddy_credit_prior");
  const priorSeat = alias(bookings, "buddy_credit_prior_seat");
  const dock = alias(rollCallEvents, "buddy_credit_dock");
  const newerDock = alias(rollCallEvents, "buddy_credit_newer_dock");
  const backBefore = new Date(now.getTime() - rungOffsetMs("back_grace_over"));

  const alreadyCredited = db
    .select({ one: sql`1` })
    .from(prior)
    .innerJoin(
      priorSeat,
      and(eq(priorSeat.shopId, prior.shopId), eq(priorSeat.id, prior.bookingId)),
    )
    .where(
      and(
        eq(prior.shopId, bookingReferrals.shopId),
        eq(prior.reason, "referral"),
        eq(prior.personId, referrer.personId),
        eq(priorSeat.personId, bookings.personId),
      ),
    );
  const dockSupersedes = db
    .select({ one: sql`1` })
    .from(newerDock)
    .where(
      and(
        seatMarks(newerDock),
        eq(newerDock.shopId, dock.shopId),
        eq(newerDock.bookingId, dock.bookingId),
        eq(newerDock.checkpoint, dock.checkpoint),
        sql`coalesce(${newerDock.meetingDay}, 0) = coalesce(${dock.meetingDay}, 0)`,
        isNewerMark(newerDock, dock),
      ),
    );
  const stayedAshore = db
    .select({ one: sql`1` })
    .from(dock)
    .where(
      and(
        seatMarks(dock),
        eq(dock.shopId, bookings.shopId),
        eq(dock.bookingId, bookings.id),
        eq(dock.checkpoint, "departure"),
        eq(dock.status, "not_boarded"),
        notExists(dockSupersedes),
      ),
    );

  return (
    db
      .select({
        shopId: bookingReferrals.shopId,
        buddyBookingId: bookings.id,
        referrerPersonId: referrer.personId,
      })
      .from(bookingReferrals)
      .innerJoin(
        shops,
        and(
          eq(shops.id, bookingReferrals.shopId),
          eq(shops.buddyLinksEnabled, true),
          gt(shops.buddyCreditCents, 0),
        ),
      )
      .innerJoin(
        bookings,
        and(
          eq(bookings.id, bookingReferrals.bookingId),
          eq(bookings.shopId, bookingReferrals.shopId),
        ),
      )
      .innerJoin(
        trips,
        and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookingReferrals.shopId)),
      )
      .innerJoin(
        referrer,
        and(
          eq(referrer.id, bookingReferrals.referredByBookingId),
          eq(referrer.shopId, bookingReferrals.shopId),
        ),
      )
      .innerJoin(
        referrerPerson,
        and(
          eq(referrerPerson.id, referrer.personId),
          eq(referrerPerson.shopId, bookingReferrals.shopId),
          isNull(referrerPerson.deletedAt),
          isNull(referrerPerson.anonymizedAt),
          isNull(referrerPerson.mergedIntoPersonId),
        ),
      )
      .where(
        and(
          buddyBookingId ? eq(bookings.id, buddyBookingId) : undefined,
          numberedDiveDay(),
          seatHeld,
          eq(trips.status, "scheduled"),
          notRehearsal(),
          sql`${trips.endsAt} <= ${backBefore}`,
          ne(bookings.personId, referrer.personId),
          notExists(stayedAshore),
          notExists(alreadyCredited),
        ),
      )
      // diveday:allow-time-id-order: a sweep's drain order, never shown to anyone
      .orderBy(asc(trips.endsAt), asc(bookings.id))
      // A booking id is unique, so the recheck already returns at most one row.
      .limit(BUDDY_CREDIT_SWEEP_LIMIT)
  );
}

/**
 * One referral's credit, rechecked under the referrer's ledger lock in the
 * order `grantTripCredit` takes them (shop, then person, both NOWAIT). The
 * entry id is the buddy seat's own (`buddyCreditEntryId`) and
 * `trip_credit_entries_referral_once` holds the seat to one row, so a second
 * pass, or a second tick racing this one, writes nothing.
 */
async function grantOne(
  db: AppDb,
  now: Date,
  candidate: Candidate,
): Promise<"granted" | "skipped" | "busy"> {
  try {
    return await db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const [shop] = await tx
        .select({ currency: shops.currency, amountCents: shops.buddyCreditCents })
        .from(shops)
        .where(eq(shops.id, candidate.shopId))
        // mutation-ok: lock contention cannot be provoked on PGlite's single connection; see the ADR
        .for("share", { noWait: true });
      if (!shop || !/^[a-z]{3}$/.test(shop.currency) || !validTripCreditAmount(shop.amountCents))
        return "skipped";
      // mutation-ok: the eligibleReferrals recheck below refuses the same cases; this is defense in depth
      if (!(await lockTripCreditPerson(tx, candidate.shopId, candidate.referrerPersonId)))
        return "skipped";
      const [still] = await eligibleReferrals(tx, now, candidate.buddyBookingId);
      if (!still || still.referrerPersonId !== candidate.referrerPersonId) return "skipped";
      const balance = await tripCreditBalance(
        tx,
        candidate.shopId,
        candidate.referrerPersonId,
        shop.currency,
      );
      if (balance === null || !Number.isSafeInteger(balance + shop.amountCents)) return "skipped";
      const [entry] = await tx
        .insert(tripCreditEntries)
        .values({
          id: buddyCreditEntryId(candidate.buddyBookingId),
          shopId: candidate.shopId,
          personId: candidate.referrerPersonId,
          actorPersonId: null,
          currency: shop.currency,
          kind: "grant",
          amountCents: shop.amountCents,
          reason: "referral",
          bookingId: candidate.buddyBookingId,
        })
        .onConflictDoNothing()
        .returning({ id: tripCreditEntries.id });
      return entry ? "granted" : "skipped";
    });
  } catch (error) {
    if (isLockWaitRefusal(error)) return "busy";
    throw error;
  }
}

/**
 * **The shop tick's buddy-credit pass**: every shop's referrals that earned
 * their credit since the last tick, at most {@link BUDDY_CREDIT_SWEEP_LIMIT}.
 * A busy referrer is tried again next hour.
 */
export async function grantBuddyCredits(
  db: AppDb,
  { now }: { now: Date },
): Promise<BuddyCreditSweepSummary> {
  const summary: BuddyCreditSweepSummary = { granted: 0, busy: 0, skipped: 0 };
  for (const candidate of await eligibleReferrals(db, now)) {
    summary[await grantOne(db, now, candidate)] += 1;
  }
  return summary;
}
