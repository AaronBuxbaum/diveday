import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { recordRollCall } from "@/db/manifests";
import { queueMediaDeletion, STALE_PENDING_AFTER_MS } from "@/db/media-deletions";
import { STALE_AFTER_MS } from "@/db/payment-operations";
import { recordProcessorErasureObligations } from "@/db/processor-erasure";
import { getShopReviewAggregate, setReviewPublished } from "@/db/reviews";
import {
  bookingPayments,
  bookings,
  certifications,
  gearItems,
  gearReservations,
  gearServiceEvents,
  mediaDeletionAttempts,
  nitroxCertifications,
  paymentOperationIntents,
  people,
  personRoles,
  processorErasureObligations,
  specialtyCertifications,
  tripReviews,
  trips,
  waiverRecords,
} from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { completeWaiver, issueWaiverRequest, recordWaiverDelivery } from "@/db/waivers";
import { STAFF_ROLES } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
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

  // 7. A diver whose release went out two ways and only landed one of them, so
  //    the record's delivery row shows both a refused channel and a settled
  //    one at once. Nothing in the seed can produce it: a delivery outcome
  //    needs a provider, and the demo shop has none — which is precisely why
  //    the ring on those buttons had no baseline.
  await markMixedWaiverDelivery(db, shop.id);

  // 8. Gear on its worst day (ADR 20260815-minimal-gear-register): one seeded
  //    reservation dragged into the past so the register's returns panel wears
  //    its amber "was due" state and Today gains its gear-overdue row, and one
  //    tank's visual-inspection clock expired so the service column and the
  //    unit page show the overdue grammar. Backdated in place rather than
  //    seeded: the demo fleet stays calm (seed-gear.ts keeps every clock
  //    ahead), same call as seed-front-desk's `succeeded` payment.
  const overdueWindow = {
    reservedFrom: calendarDateInTimezone(new Date(now.getTime() - 4 * 24 * HOUR_MS), shop.timezone),
    reservedUntil: calendarDateInTimezone(
      new Date(now.getTime() - 2 * 24 * HOUR_MS),
      shop.timezone,
    ),
  };
  const [overdueUnit] = await db
    .select({ id: gearItems.id })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shop.id), eq(gearItems.label, "BCD #2")))
    .limit(1);
  if (overdueUnit) {
    await db
      .update(gearReservations)
      .set({ ...overdueWindow, checkedOutAt: new Date(now.getTime() - 4 * 24 * HOUR_MS) })
      .where(eq(gearReservations.gearItemId, overdueUnit.id));
  }
  const [lapsedTank] = await db
    .select({ id: gearItems.id })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shop.id), eq(gearItems.label, "AL80-03")))
    .limit(1);
  if (lapsedTank) {
    await db
      .update(gearServiceEvents)
      .set({
        nextDueOn: calendarDateInTimezone(
          new Date(now.getTime() - 35 * 24 * HOUR_MS),
          shop.timezone,
        ),
      })
      .where(
        and(
          eq(gearServiceEvents.gearItemId, lapsedTank.id),
          eq(gearServiceEvents.kind, "visual_inspection"),
        ),
      );
  }

  // **Opt-in, unlike every other state here.** The rest write self-contained
  // back-office rows — a stuck deletion, an owed erasure — that only the panel
  // they belong to reads. This one changes a diver's **readiness**, which the
  // nav badges, the close-out and every blocked count read too, so seeding it
  // unconditionally moved nine unrelated captures. A capture that wants it asks
  // for it.
  if (new URL(request.url).searchParams.get("blockedAboard") === "1") {
    await boardADiverThenBlockThem(db, shop.id, now);
  }

  // Opt-in for the same reason: it boards a whole boat, which moves every
  // aboard count on the page.
  if (new URL(request.url).searchParams.get("crewUncounted") === "1") {
    await boardEveryDiverAndNoCrew(db, shop.id, now);
  }

  return NextResponse.json({ ok: true });
}

/**
 * **A full boat whose crew nobody has counted** — the state where somebody may
 * still be on the dock, or in the water, and every diver-shaped signal on the
 * page says the day is going perfectly.
 *
 * Today's departure card celebrated exactly here, on `boarded === booked`,
 * while the manifest reading the same departure correctly refused to close the
 * checkpoint (issue #789). Now it says the crew roll call is still open, in a
 * warning tone — and a warning nothing has ever photographed is a warning
 * nobody has ever looked at (AGENTS.md).
 *
 * Reached the honest way: sign each diver's release so the app is willing to
 * board them, board them through the real writer, and record nothing at all for
 * the crew. Not seeded into `blue-mantis`, like everything else in this file: a
 * demo that opens every capture on an uncounted crew is a worse demo.
 */
async function boardEveryDiverAndNoCrew(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  now: Date,
): Promise<void> {
  const [crew] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])))
    .limit(1);
  if (!crew) return;

  // The *next* departure only. Ordered by the trip's start and then the diver's
  // name — never `bookings.id`, which is `defaultRandom()` and re-seeded before
  // every test, so ordering by it makes the capture photograph a different boat
  // each run (the mistake this file already carries a paragraph about).
  const [next] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        // The same 1-hour late-departure buffer every "has it sailed" question
        // in this app uses. Without it this picked the earliest scheduled trip
        // in the seed — one that sailed weeks ago and is on no board.
        gte(trips.startsAt, new Date(now.getTime() - HOUR_MS)),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!next) return;

  const roster = await db
    .select({ id: bookings.id, personId: bookings.personId, fullName: people.fullName })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(eq(bookings.shopId, shopId), eq(bookings.tripId, next.id), eq(bookings.status, "booked")),
    )
    .orderBy(people.fullName);

  for (const seat of roster) {
    // A diver the seed already had sign is refused a second link, which is the
    // state we want anyway.
    const issued = await issueWaiverRequest(db, { shopId, bookingId: seat.id });
    if (issued.ok) {
      await completeWaiver(db, issued.token, {
        signerName: seat.fullName,
        agreed: true,
        medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      });
    }
    const board = () =>
      recordRollCall(db, {
        shopId,
        tripId: next.id,
        bookingId: seat.id,
        recordedByPersonId: crew.id,
        status: "boarded",
      });
    if ((await board()).ok) continue;
    // `not_ready` is the gate doing its job, and the seeded boat has a diver
    // with no card on file (Nadia Petrov) precisely so that something
    // photographs a blocked one. This capture is about the *crew* half, so the
    // diver half has to be clean — verify her card the way a front desk would,
    // and board her through the same writer, rather than reaching past the
    // gate with a direct write.
    await db.insert(certifications).values({
      shopId,
      personId: seat.personId,
      agency: "padi" as const,
      level: "open_water" as const,
      identifier: "DEMO-CREW-UNCOUNTED",
      status: "verified" as const,
      reviewedByPersonId: crew.id,
      reviewedAt: now,
    });
    await board();
  }
  // And deliberately no `recordCrewRollCall` — that absence is the capture.
}

/**
 * **A blocked diver already on the boat**, which is the state the departure
 * card's aboard line exists for and which nothing had ever photographed.
 *
 * It cannot be reached by boarding a blocked diver: `recordRollCall` refuses
 * one at the departure checkpoint (`not_ready`), and the after-dive head count
 * writes a checkpoint this card does not read. That gate is correct and stays.
 *
 * The state arises the other way round, in production, because **readiness is
 * evaluated live**: a diver boards while clear and *then* becomes blocked. A
 * waiver ages out mid-morning, a card is un-verified, a payment is refunded.
 * So that is the sequence here — board a diver the app is happy to board, then
 * supersede their signed release — which also means the real writer runs and
 * its refusal still stands for everyone it should.
 *
 * Not seeded into `blue-mantis` for the same reason nothing else in this file
 * is: a demo whose every capture shows a blocked diver aboard is a worse demo,
 * and the card's ordinary state is what the other captures are for.
 */
async function boardADiverThenBlockThem(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  now: Date,
): Promise<void> {
  // The next departure's roster, ordered **by the diver's name** — whoever the
  // app will let aboard, chosen the same way every run.
  //
  // Not `bookings.id`, which is what this said first: that column is
  // `defaultRandom()`, and `/api/test/reset` re-seeds the bookings before every
  // test, so the "first" booking was a fresh random uuid each time. The capture
  // boarded Diego Alvarez on one run and Ines Costa on the next, and reported
  // as changed on the very next pull request — a baseline that moves on its own
  // is one a reviewer learns to wave through (AGENTS.md). Seeded names do not
  // move.
  const candidates = await db
    .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.status, "booked"),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, new Date(now.getTime() - HOUR_MS)),
      ),
    )
    .orderBy(trips.startsAt, people.fullName);

  // **A staff person, not just any person.** `recordRollCall` refuses with
  // `staff_not_found` otherwise, and the route's shared `actor` is whichever
  // row came first — fine for the panels that only name who acted, and not for
  // this, which is a real safety write going through the real writer.
  const [crew] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])))
    .limit(1);
  if (!crew) return;

  for (const booking of candidates) {
    const boarded = await recordRollCall(db, {
      shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      recordedByPersonId: crew.id,
      status: "boarded",
    });
    // `not_ready` is the gate doing its job — that diver is blocked and the
    // app refuses to board them. Try the next seat.
    if (!boarded.ok) continue;
    // Now take the release out from under them, the way an expiry would.
    await db
      .update(waiverRecords)
      .set({ supersededAt: now })
      .where(
        and(
          eq(waiverRecords.shopId, shopId),
          eq(waiverRecords.personId, booking.personId),
          isNull(waiverRecords.supersededAt),
        ),
      );
    return;
  }
}

/**
 * Give Priya's outstanding release one failed email and one delivered text.
 *
 * Priya is the seed's deliberate waiver holdout (`src/db/seed-bookings.ts`), so
 * her record is the one that offers all four ways of getting a release signed —
 * the same record `diver-profile-paper-waiver` photographs at rest. Issuing here
 * rather than in the seed keeps that calm capture calm.
 */
async function markMixedWaiverDelivery(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
): Promise<void> {
  const [priya] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Priya Sharma")))
    .limit(1);
  if (!priya) return;
  const issued = await issueWaiverRequest(db, { shopId, personId: priya.id });
  if (!issued.ok) return;
  // Email first, text second: the record's own latest-attempt columns take the
  // last write, and "the text got through" is the truer summary of the pair.
  await recordWaiverDelivery(db, {
    shopId,
    waiverRecordId: issued.recordId,
    channel: "email",
    delivery: { status: "failed", detail: "mailbox does not exist" },
  });
  await recordWaiverDelivery(db, {
    shopId,
    waiverRecordId: issued.recordId,
    channel: "text",
    delivery: { status: "sent" },
  });
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
