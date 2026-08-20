import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { queueMediaDeletion, STALE_PENDING_AFTER_MS } from "@/db/media-deletions";
import { STALE_AFTER_MS } from "@/db/payment-operations";
import { recordProcessorErasureObligations } from "@/db/processor-erasure";
import { getShopReviewAggregate, setReviewPublished } from "@/db/reviews";
import {
  bookingPayments,
  bookings,
  certifications,
  mediaDeletionAttempts,
  nitroxCertifications,
  paymentOperationIntents,
  people,
  processorErasureObligations,
  specialtyCertifications,
  tripReviews,
  trips,
} from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { MAX_SUPPRESSED_SHARE_FOR_RATING } from "@/lib/reviews";

/**
 * Puts the seeded demo shop into the trouble states that only render when
 * something has gone wrong, plus a diver record state, so visual captures can
 * photograph them.
 *
 * These panels — stuck payment operations and owed refunds on the Orders
 * index, stuck media deletions and owed processor erasures in Settings' "Data &
 * integrations" group, the rating-withheld banner on Reviews, and a diver's
 * no-card declaration on the diver record — are the
 * class of surface **most** likely to render badly and least likely to be
 * looked at: warning-toned blocks of dense text with inline links, seen by a
 * shop on its worst day. Until this route none of them had ever been
 * photographed, so any of them could ship with broken layout, an untranslated
 * string, or unreadable dark-mode contrast and nothing in CI would notice.
 *
 * ## Why this is a route and not seed data
 *
 * `src/db/seed-front-desk.ts` seeds its payment operation as `succeeded` on
 * purpose, and says why: a seeded failure "would put a permanent red row on the
 * dashboard that no amount of retrying clears, since there is no provider
 * behind it to succeed on the second attempt." A demo shop permanently
 * shouting that four payments are broken is a worse demo, and that call stands.
 *
 * A test-only route keeps the demo pristine and the coverage real. It is safe
 * to mutate freely because of the fleet's topology (`e2e/servers.ts`): each
 * Playwright worker has its **own** `next start` server on its own port backed
 * by its own in-memory PGlite database, and `e2e/fixtures.ts` resets that
 * database before every test. So this cannot reach another test's capture, and
 * nothing has to undo it afterwards.
 *
 * Gated identically to /api/test/reset — and, like every route here, it
 * resolves the shop itself from `DEMO_SHOP_SLUG` and refuses a shop that is not
 * `isDemo`, rather than taking an id from the caller.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });

  const now = nowDate();
  // One of the shop's own people, for the two rows that name who acted. Which
  // one does not matter to any of these panels; that it belongs to this shop
  // does, and every row below is written against `shop.id` for the same reason.
  const [actor] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id))
    .orderBy(people.createdAt)
    .limit(1);
  if (!actor) return NextResponse.json({ error: "not_seeded" }, { status: 409 });

  // 6. A diver who said they hold no card, so the record's warning panel and
  // its staff eraser can be exercised without putting a permanent warning in
  // the demo seed. Nadia Petrov is a healthy, uncarded fixture diver; the
  // exact name keeps this state deterministic and prevents the first-person
  // ordering above from coupling unrelated trouble panels to it.
  const [nadia] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Nadia Petrov")))
    .limit(1);
  if (nadia) {
    await db.delete(nitroxCertifications).where(eq(nitroxCertifications.personId, nadia.id));
    await db.delete(specialtyCertifications).where(eq(specialtyCertifications.personId, nadia.id));
    await db.delete(certifications).where(eq(certifications.personId, nadia.id));
  }
  await db
    .update(people)
    .set({
      noCertificationDeclaredAt: now,
      noCertificationClearedAt: null,
      noCertificationClearedByPersonId: null,
    })
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Nadia Petrov")));

  // 1. A payment operation nobody ever confirmed. `listStuckPaymentOperations`
  //    reads `started` intents older than STALE_AFTER_MS, so the row is
  //    backdated past that window rather than merely left open.
  const [firstTrip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .orderBy(trips.startsAt)
    .limit(1);
  await db
    .insert(paymentOperationIntents)
    .values({
      shopId: shop.id,
      kind: "checkout_session",
      status: "started",
      tripId: firstTrip?.id ?? null,
      stripeObjectId: "cs_e2e_stuck",
      startedAt: new Date(now.getTime() - STALE_AFTER_MS * 4),
    })
    .onConflictDoNothing();

  // 2. Somebody is owed money: a departure the shop cancelled that still
  //    carries a paid seat. `listOwedShopCancellationRefunds` joins a paid
  //    booking_payment to a `cancelled` trip whose booking is *not* cancelled
  //    (the forfeit carve-out), so cancelling the trip is the whole edit.
  const [paidSeat] = await db
    .select({ tripId: bookings.tripId })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .where(
      and(
        eq(bookingPayments.shopId, shop.id),
        inArray(bookingPayments.status, ["paid", "deposit_paid"]),
      ),
    )
    .limit(1);
  if (paidSeat) {
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, paidSeat.tripId));
  }

  // 3. A photo delete the provider refused, and
  // 4. two erasures Stripe still owes — the panels that lead Settings' "Data &
  //    integrations" group, one per target kind so the capture shows both the
  //    row DiveDay can retry and the invoice snapshot only a human can discharge.
  const attempt = await queueMediaDeletion(db, {
    shopId: shop.id,
    kind: "recap_photo",
    url: "https://e2e.public.blob.vercel-storage.com/recap/stuck-e2e.jpg",
  });
  if (attempt) {
    // `failed` rather than a stale `pending`: both render, but a failure is the
    // one that carries a `lastError` for the panel to show, and it does not
    // depend on the frozen clock having moved past STALE_PENDING_AFTER_MS.
    await db
      .update(mediaDeletionAttempts)
      .set({
        status: "failed",
        attempts: 2,
        lastError: "Blob storage returned 503",
        createdAt: new Date(now.getTime() - STALE_PENDING_AFTER_MS * 4),
      })
      .where(eq(mediaDeletionAttempts.id, attempt.id));
  }

  const erasureExternalIds = ["cus_e2e_owed", "in_e2e_owed"];
  await recordProcessorErasureObligations(db, {
    shopId: shop.id,
    personId: actor.id,
    targets: [
      {
        target: "stripe_customer",
        externalId: erasureExternalIds[0],
        stripeAccountId: "acct_e2e_test",
      },
      {
        target: "stripe_invoice_snapshot",
        externalId: erasureExternalIds[1],
        stripeAccountId: "acct_e2e_test",
      },
    ],
  });
  // Pull `created_at` onto the frozen clock, exactly as the media-deletion
  // attempt above does, and for a reason the panel makes visible: each of these
  // rows renders "raised {date}", and `created_at` is `defaultNow()` — stamped
  // by *Postgres*, which `DIVEDAY_CLOCK` does not reach (see `dbNow`'s docblock
  // in src/test/db.ts). So this capture read the real calendar and changed on
  // its own every midnight: the baseline said "raised Fri, Aug 14" and the next
  // day's run said "raised Sat, Aug 15", failing visual regression on a PR that
  // had touched nothing. Found on 2026-08-15 from a diff on an infrastructure
  // change that cannot render a pixel.
  //
  // Written here rather than by teaching `recordProcessorErasureObligations` an
  // optional timestamp: production genuinely wants the database's own clock on
  // this column, and a test-only seam does not belong in the writer that the
  // erasure path depends on.
  //
  // Matched on the external ids rather than on what the call above returned,
  // and that is the whole correctness of it: `recordProcessorErasureObligations`
  // is `onConflictDoNothing`, so against a database that already holds these
  // rows it returns an EMPTY array. This route is idempotent by design and the
  // e2e fleet re-posts it, so keying the update off the returned rows would
  // silently do nothing on every run after the first and leave exactly the
  // wall-clock date this exists to remove. Caught by fixing it the wrong way
  // first and watching the capture still read "Sat, Aug 15".
  await db
    .update(processorErasureObligations)
    .set({ createdAt: now })
    .where(
      and(
        eq(processorErasureObligations.shopId, shop.id),
        inArray(processorErasureObligations.externalId, erasureExternalIds),
      ),
    );

  // 5. The shop has hidden its way past the line where DiveDay stops publishing
  //    its rating. Through `setReviewPublished`, not a raw update, because a
  //    review only counts as *suppressed* when a `hidden` moderation event
  //    exists for it — an unpublished review with no event is merely awaiting a
  //    decision, and writing the row without the event would produce a demo
  //    state the product itself can never reach.
  await hideEnoughReviewsToWithholdTheRating(db, shop.id, actor.id);

  return NextResponse.json({ ok: true });
}

/**
 * How many reviews it takes is computed rather than hard-coded: the seed's
 * review count moves, and a fixed number would one day stop crossing the line
 * and quietly turn this capture into a photograph of nothing.
 *
 * Hiding `h` of `j` judged reviews leaves a suppressed share of
 * `(s + h) / j` — hiding does not change how many have been judged — so the
 * smallest `h` that clears `MAX_SUPPRESSED_SHARE_FOR_RATING` is one more than
 * the share's own share of the total, floored.
 */
async function hideEnoughReviewsToWithholdTheRating(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  recordedByPersonId: string,
): Promise<void> {
  const aggregate = await getShopReviewAggregate(db, shopId);
  const judged = aggregate.count + aggregate.suppressedCount;
  const needed =
    Math.floor(MAX_SUPPRESSED_SHARE_FOR_RATING * judged) + 1 - aggregate.suppressedCount;
  if (needed <= 0) return;

  const published = await db
    .select({ id: tripReviews.id })
    .from(tripReviews)
    .where(and(eq(tripReviews.shopId, shopId), eq(tripReviews.isPublished, true)))
    .orderBy(tripReviews.createdAt)
    .limit(needed);
  for (const review of published) {
    await setReviewPublished(db, shopId, review.id, false, {
      recordedByPersonId,
      reason: "spam",
    });
  }
}
