import { and, eq, inArray } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { queueMediaDeletion } from "../../db/media-deletions";
import {
  cards,
  gearItems,
  gearReservations,
  gearServiceEvents,
  mediaDeletionAttempts,
  paymentOperationIntents,
  people,
  processorErasureObligations,
  trips,
} from "../../db/schema/index";
import { recordProcessorErasureObligations } from "../../features/processor-erasure/store";
import { ATTEMPT_RULES } from "../../lib/attempts";
import { calendarDateInTimezone } from "../../lib/calendar-date";
import { HOUR_MS } from "../../lib/clock";

/**
 * The back-office trouble panels that only render when something has gone
 * wrong, one function per fact (`src/test/shop-facts/index.ts`): stuck payment
 * operations and owed refunds on the Orders index, stuck media deletions and
 * owed processor erasures in Settings' "Data & integrations" group, the
 * rating-withheld banner on Reviews, and a diver's no-card declaration on the
 * diver record. A shop sees them on its worst day, which is why they are
 * photographed, and why the demo shop must never carry them by default: a demo
 * permanently shouting that four payments are broken is a worse demo
 * (`src/db/seed-front-desk.ts` seeds its payment `succeeded` for that reason).
 *
 * Each Playwright worker has its own server and in-memory PGlite database
 * (`e2e/servers.ts`), reset before every test (`e2e/fixtures.ts`), so these
 * writes cannot reach another capture.
 */

/**
 * A diver who said they hold no card, so the record's warning panel and its
 * staff eraser can be exercised without putting a permanent warning in the demo
 * seed. Nadia Petrov is a healthy, uncarded fixture diver; the exact name keeps
 * this state deterministic and keeps unrelated trouble panels from coupling to
 * the first-person ordering.
 */
export async function declareNoCard(db: AppDb, shopId: string, now: Date): Promise<void> {
  const [nadia] = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Nadia Petrov")))
    .limit(1);
  if (nadia) {
    await db.delete(cards).where(and(eq(cards.kind, "nitrox"), eq(cards.personId, nadia.id)));
    await db.delete(cards).where(and(eq(cards.kind, "specialty"), eq(cards.personId, nadia.id)));
    await db.delete(cards).where(and(eq(cards.kind, "level"), eq(cards.personId, nadia.id)));
  }
  await db
    .update(people)
    .set({
      noCertificationDeclaredAt: now,
      noCertificationClearedAt: null,
      noCertificationClearedByPersonId: null,
    })
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Nadia Petrov")));
}

/**
 * A payment operation nobody ever confirmed. The `payment_operation` kind of
 * `listUnfinished` reads `started` intents older than
 * ATTEMPT_RULES.payment_operation.stuckAfterMs, so the row is backdated past
 * that window rather than merely left open.
 */
export async function leavePaymentUnconfirmed(db: AppDb, shopId: string, now: Date): Promise<void> {
  const [firstTrip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, shopId))
    .orderBy(trips.startsAt)
    .limit(1);
  await db
    .insert(paymentOperationIntents)
    .values({
      shopId,
      kind: "checkout_session",
      status: "started",
      tripId: firstTrip?.id ?? null,
      stripeObjectId: "cs_e2e_stuck",
      startedAt: new Date(now.getTime() - ATTEMPT_RULES.payment_operation.stuckAfterMs * 4),
    })
    .onConflictDoNothing();
}

/**
 * A photo delete the provider refused. `failed` rather than a stale `pending`:
 * both render, but a failure carries a `lastError` for the panel to show, and
 * it does not depend on the frozen clock having moved past
 * ATTEMPT_RULES.media_deletion.stuckAfterMs.
 */
export async function refuseAPhotoDelete(db: AppDb, shopId: string, now: Date): Promise<void> {
  const attempt = await queueMediaDeletion(db, {
    shopId,
    kind: "recap_photo",
    url: "https://diveday-media.s3.us-east-1.amazonaws.com/recap/stuck-e2e.jpg",
  });
  if (!attempt) return;
  await db
    .update(mediaDeletionAttempts)
    .set({
      status: "failed",
      attempts: 2,
      lastError: "Blob storage returned 503",
      createdAt: new Date(now.getTime() - ATTEMPT_RULES.media_deletion.stuckAfterMs * 4),
    })
    .where(eq(mediaDeletionAttempts.id, attempt.id));
}

/**
 * Two erasures Stripe still owes, one per target kind, so the capture shows both
 * the row DiveDay can retry and the invoice snapshot only a human can discharge.
 *
 * `created_at` is pulled onto the frozen clock: each row renders "raised
 * {date}", and `created_at` is `defaultNow()`, stamped by *Postgres*, which
 * `DIVEDAY_CLOCK` does not reach (see `dbNow`'s docblock in src/test/db.ts). The
 * capture otherwise read the real calendar and changed every midnight. Written
 * here rather than by teaching `recordProcessorErasureObligations` an optional
 * timestamp: production wants the database's own clock on this column.
 *
 * Matched on the external ids rather than on what the writer returned: it is
 * `onConflictDoNothing`, so against a database that already holds these rows it
 * returns an EMPTY array, and the fleet re-posts this fact.
 */
export async function oweStripeTwoErasures(
  db: AppDb,
  shopId: string,
  actorId: string,
  now: Date,
): Promise<void> {
  const externalIds = ["cus_e2e_owed", "in_e2e_owed"];
  await recordProcessorErasureObligations(db, {
    shopId,
    personId: actorId,
    targets: [
      { target: "stripe_customer", externalId: externalIds[0], stripeAccountId: "acct_e2e_test" },
      {
        target: "stripe_invoice_snapshot",
        externalId: externalIds[1],
        stripeAccountId: "acct_e2e_test",
      },
    ],
  });
  await db
    .update(processorErasureObligations)
    .set({ createdAt: now })
    .where(
      and(
        eq(processorErasureObligations.shopId, shopId),
        inArray(processorErasureObligations.externalId, externalIds),
      ),
    );
}

/**
 * Gear on its worst day (ADR 20260815-minimal-gear-register): one diver's kit
 * dragged into the past so the register's Overdue group wears its amber "was
 * due" state and Today gains its gear-overdue row, and one tank's
 * visual-inspection clock expired so the service sentence and the unit page
 * show the overdue grammar. Backdated in place rather than seeded: the demo
 * fleet stays calm (seed-gear.ts keeps every clock ahead).
 */
export async function runGearOverdue(
  db: AppDb,
  shopId: string,
  now: Date,
  timezone: string,
): Promise<void> {
  const overdueWindow = {
    reservedFrom: calendarDateInTimezone(new Date(now.getTime() - 4 * 24 * HOUR_MS), timezone),
    reservedUntil: calendarDateInTimezone(new Date(now.getTime() - 2 * 24 * HOUR_MS), timezone),
  };
  const [overdueUnit] = await db
    .select({ id: gearItems.id })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), eq(gearItems.label, "BCD #2")))
    .limit(1);
  // The whole kit that went out with BCD #2 (its regulator and wetsuit ride the
  // same booking) comes back late together: three units on the register, one
  // combined row on Today.
  const [overdueKit] = overdueUnit
    ? await db
        .select({ bookingId: gearReservations.bookingId })
        .from(gearReservations)
        .where(eq(gearReservations.gearItemId, overdueUnit.id))
        .limit(1)
    : [];
  if (overdueKit?.bookingId) {
    await db
      .update(gearReservations)
      .set({ ...overdueWindow, checkedOutAt: new Date(now.getTime() - 4 * 24 * HOUR_MS) })
      .where(
        and(
          eq(gearReservations.shopId, shopId),
          eq(gearReservations.bookingId, overdueKit.bookingId),
        ),
      );
  }
  const [lapsedTank] = await db
    .select({ id: gearItems.id })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), eq(gearItems.label, "AL80-03")))
    .limit(1);
  if (lapsedTank) {
    await db
      .update(gearServiceEvents)
      .set({
        nextDueOn: calendarDateInTimezone(new Date(now.getTime() - 35 * 24 * HOUR_MS), timezone),
      })
      .where(
        and(
          eq(gearServiceEvents.gearItemId, lapsedTank.id),
          eq(gearServiceEvents.kind, "visual_inspection"),
        ),
      );
  }
}
