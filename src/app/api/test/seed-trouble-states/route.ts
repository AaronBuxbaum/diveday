import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { queueMediaDeletion, STALE_PENDING_AFTER_MS } from "@/db/media-deletions";
import { STALE_AFTER_MS } from "@/db/payment-operations";
import { recordProcessorErasureObligations } from "@/db/processor-erasure";
import {
  certifications,
  gearItems,
  gearReservations,
  gearServiceEvents,
  mediaDeletionAttempts,
  nitroxCertifications,
  paymentOperationIntents,
  people,
  processorErasureObligations,
  specialtyCertifications,
  trips,
} from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized, requireDemoTenant, testRouteRefused } from "@/lib/e2e-test-routes";
import { boatAndMergeStates } from "./merge-candidates-state";
import { addASiteItsStationIsNowhereNear } from "./states/add-a-site-its-station-is-nowhere-near";
import { askForAPieceTheShopNoLongerRents } from "./states/ask-for-a-piece-the-shop-no-longer-rents";
import { askForAnIntroSessionPastItsRatio } from "./states/ask-for-an-intro-session-past-its-ratio";
import { batchFourStates } from "./states/batch-four-states";
import { boardADiverThenBlockThem } from "./states/board-a-diver-then-block-them";
import { boardEveryDiverAndNoCrew } from "./states/board-every-diver-and-no-crew";
import { bounceThreeConfirmations } from "./states/bounce-three-confirmations";
import { cancelADepartureSomebodyPaidFor } from "./states/cancel-a-departure-somebody-paid-for";
import { carrySomebodyWhoIsNotDiving } from "./states/carry-somebody-who-is-not-diving";
import { countHeadsOnADepartureNobodyWillMove } from "./states/count-heads-on-a-departure-nobody-will-move";
import { flagFourUnitsOnTheReefBoat } from "./states/flag-four-units-on-the-reef-boat";
import { hideEnoughReviewsToWithholdTheRating } from "./states/hide-enough-reviews-to-withhold-the-rating";
import { letTheReefBoatsKitLapse } from "./states/let-the-reef-boats-kit-lapse";
import { markMixedWaiverDelivery } from "./states/mark-mixed-waiver-delivery";
import { putOneUnitOutToday } from "./states/put-one-unit-out-today";
import { putTheBenchBehind } from "./states/put-the-bench-behind";
import { sayPriyaIsRunningLate } from "./states/say-priya-is-running-late";
import { seatSomebodyOffTheNamePrompt } from "./states/seat-somebody-off-the-name-prompt";
import { seedOwedMoney } from "./states/seed-owed-money";
import { slideOneDepartureOntoAnother } from "./states/slide-one-departure-onto-another";
import { unsignTheSeededMinorsRelease } from "./states/unsign-the-seeded-minors-release";
import { unstaffTomorrowsDeparture } from "./states/unstaff-tomorrows-departure";
import { troubleVariantResponse } from "./variant-response";

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
 * A test-only route keeps the demo pristine. Each Playwright worker has its
 * own server and in-memory PGlite database (`e2e/servers.ts`), reset before
 * every test (`e2e/fixtures.ts`), so these writes cannot reach another capture.
 *
 * Gated identically to /api/test/reset. Every variant refuses non-demo shops;
 * operational fixtures may name a private demo by slug.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) return testRouteRefused();
  const db = await getDb();
  const variant = await troubleVariantResponse(request, db);
  if (variant) return variant;
  const params = new URL(request.url).searchParams;
  const tenant = await requireDemoTenant(request, () => getShopBySlug(db, DEMO_SHOP_SLUG));
  if (!tenant.ok) return tenant.response;
  const { shop } = tenant;

  const now = nowDate();
  // One of the shop's own people, for the two rows that name who acted. Which one does not matter
  // to any of these panels; that it belongs to this shop does, and every row below is written
  // against `shop.id` for the same reason.
  const [actor] = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .where(eq(people.shopId, shop.id))
    .orderBy(people.createdAt)
    .limit(1);
  if (!actor) return NextResponse.json({ error: "not_seeded" }, { status: 409 });

  // 6. A diver who said they hold no card, so the record's warning panel and its staff eraser can
  // be exercised without putting a permanent warning in the demo seed. Nadia Petrov is a healthy,
  // uncarded fixture diver; the exact name keeps this state deterministic and prevents the
  // first-person ordering above from coupling unrelated trouble panels to it.
  const [nadia] = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
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

  // 2. Money the shop owes back: a paid-after-close checkout and a failed
  // refund always (`seedOwedMoney`); a cancelled departure's paid seat only on
  // request (`owedRefund`, below).
  await seedOwedMoney(db, shop.id, now);
  if (params.get("owedRefund") === "1") {
    await cancelADepartureSomebodyPaidFor(db, shop.id);
  }

  // 3. A photo delete the provider refused, and
  // 4. two erasures Stripe still owes — the panels that lead Settings' "Data &
  //    integrations" group, one per target kind so the capture shows both the
  //    row DiveDay can retry and the invoice snapshot only a human can discharge.
  const attempt = await queueMediaDeletion(db, {
    shopId: shop.id,
    kind: "recap_photo",
    url: "https://diveday-media.s3.us-east-1.amazonaws.com/recap/stuck-e2e.jpg",
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

  // 8. Gear on its worst day (ADR 20260815-minimal-gear-register): one
  //    diver's kit dragged into the past so the register's Overdue group wears
  //    its amber "was due" state and Today gains its gear-overdue row, and one
  //    tank's visual-inspection clock expired so the service sentence and the
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
  // The whole kit that went out with BCD #2 (its regulator and wetsuit ride
  // the same booking) comes back late together, the way a diver's rental
  // actually does: three units on the register, one combined row on Today.
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
          eq(gearReservations.shopId, shop.id),
          eq(gearReservations.bookingId, overdueKit.bookingId),
        ),
      );
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

  // **Opt-in, like the owed refund above.** The back-office states write self-contained
  // back-office rows — a stuck deletion, an owed erasure — that only the panel
  // they belong to reads. This one changes a diver's **readiness**, which the
  // nav badges, the close-out and every blocked count read too, so seeding it
  // unconditionally moved nine unrelated captures. A capture that wants it asks
  // for it.
  // The departure it boarded is returned, so the manifest capture addresses
  // the boat whose head count carries the line (issue #2217).
  const blockedAboard =
    params.get("blockedAboard") === "1" ? await boardADiverThenBlockThem(db, shop.id, now) : null;

  // Opt-in: three confirmations that bounced are a row on Today, and every
  // other Today capture would have paid for it.
  if (params.get("failedEmails") === "1") {
    await bounceThreeConfirmations(db, shop.id, now);
  }

  // Opt-in for the same reason: it boards a whole boat, which moves every
  // aboard count on the page.
  if (params.get("crewUncounted") === "1") {
    await boardEveryDiverAndNoCrew(db, shop.id, now);
  }

  // Opt-in for the same reason again: a unit due back today is a row on Today
  // as well as on the register, and every capture that only wanted the
  // register's Overdue group would have paid for it.
  if (params.get("gearOut") === "1") {
    await putOneUnitOutToday(db, shop.id, now, shop.timezone);
  }

  // Opt-in: a late ticket and an uncollected one are two rows on Today (ADR
  // 20261008-work-order-follow-up), and every other Today capture would have
  // paid for them.
  if (params.get("bench") === "1") {
    await putTheBenchBehind(db, shop.id, now, shop.timezone);
  }

  // Opt-in, and the widest-reaching of the lot: taking the crew off a
  // departure moves Today's queue, the trip record, the close-out and every
  // crew count in the fleet. Only the staffing week's gap capture asks for it.
  if (params.get("crewGap") === "1") {
    await unstaffTomorrowsDeparture(db, shop.id, now);
  }

  // Opt-in: four units on the reef boat's Gear tab that each need a look are
  // four warnings on that departure and on the register, and the demo's own
  // assignments must stay calm. The capture that wants them asks (issue #2221).
  const unitsNeedingCare =
    params.get("unitsNeedingCare") === "1"
      ? await flagFourUnitsOnTheReefBoat(db, shop.id, actor.id, now, shop.timezone)
      : null;

  // Opt-in, beside `crewGap` and for its reason: an intro session left short of
  // an instructor is a gap on the staffing week, Today and the trip record,
  // and the demo must not stand permanently short-handed. The one spec that
  // walks approving a divemaster onto it asks for it (issue #1676).
  const introOverRatio =
    params.get("introOverRatio") === "1"
      ? await askForAnIntroSessionPastItsRatio(db, shop.id, actor.id, now, shop.timezone)
      : null;

  // Opt-in for the first reason again — it changes a diver's readiness — and
  // it is the one state here a caller needs an answer back from: the row it
  // makes is addressed by id in the URL that photographs it.
  const blockedMinor =
    params.get("blockedMinor") === "1"
      ? await unsignTheSeededMinorsRelease(db, shop.id, now)
      : null;

  // Opt-in, and it moves a departure: the board, Today's queue and every
  // subscribed calendar's `SEQUENCE` go with it. The two captures that want a
  // standing crew clash ask for it, and both address the boat it made by id.
  const crewClash =
    params.get("crewClash") === "1"
      ? await slideOneDepartureOntoAnother(db, shop.id, now, shop.timezone)
      : null;

  // The same clash with both boats already out on the water, two hours gone:
  // no longer stations, so Today files the sailed row at the desk (H-20260916-may-one-hull-carry,
  // issue #1814). Opt-in for the same reason, and it moves two departures.
  const crewClashSailed =
    params.get("crewClashSailed") === "1"
      ? await slideOneDepartureOntoAnother(db, shop.id, now, shop.timezone, {
          hostSailedAt: new Date(now.getTime() - 2 * HOUR_MS),
        })
      : null;

  // Opt-in for the readiness reason again, and it puts a tenth name on today's
  // boat — every count on the counter, the board and Today moves with it. The
  // capture that wants the counter's held row asks for it, and addresses the
  // diver it seated by name.
  const identityHeld =
    params.get("identityHeld") === "1"
      ? await seatSomebodyOffTheNamePrompt(db, shop.id, actor.id, now)
      : null;

  // Opt-in, and it is a head count: the departure it marks reads as under way
  // on Today and on the board's own status line. The one capture that wants the
  // Move panel's refusal asks for it, and addresses the boat it marked by
  // title.
  const moveBlocked =
    params.get("moveBlocked") === "1"
      ? await countHeadsOnADepartureNobodyWillMove(db, shop.id, now)
      : null;

  // Opt-in, and the reason is the rule the whole route exists for: a demo
  // dive-site list with a standing distance warning on it is a worse demo, and
  // the advisory is a panel that only renders when something looks wrong. The
  // two captures that want it ask for it, and address the site by the slug it
  // answers with.
  const farStation =
    params.get("farStation") === "1" ? await addASiteItsStationIsNowhereNear(db, shop.id) : null;

  // Opt-in for the same reason once more, and this one reaches further than it
  // looks: `rentalFitLine` feeds the roll call, the offline snapshot and the
  // diver record from the same pieces, so a contradicted flag left standing in
  // the demo would put an unresolvable oddity on the boat manifest — the one
  // surface where a crew is trained that every line means something.
  const droppedRental =
    params.get("droppedRental") === "1"
      ? await askForAPieceTheShopNoLongerRents(db, shop.id)
      : null;

  // Opt-in: today's reef boat carrying a snorkeler and a rider (ADR
  // 20261007-participant-types), for the captures that want the badge, the
  // split head count and the public type choice. Idempotent, so it agrees with
  // a demo seed that already carries them.
  const mixedBoat =
    params.get("mixedBoat") === "1"
      ? await carrySomebodyWhoIsNotDiving(db, shop.id, actor.id, now)
      : null;

  // Opt-in: a diver on today's board who said they are running late (J3), so
  // the arrival lookup and the Divers tab have the line to photograph. Opt-in
  // because the demo's own arrivals list must stay a plain one.
  const runningLate =
    params.get("runningLate") === "1" ? await sayPriyaIsRunningLate(db, shop.id, now) : null;

  // Opt-in: a boat with lapsing safety kit, no O2 kit aboard and too many
  // people for its certificate is a danger panel on that departure's Boat tab
  // and a row on Today — exactly the standing warning the demo must not carry. The
  // captures that want the panel ask for it, and address the departure by id.
  const boatSafety =
    params.get("boatSafety") === "1"
      ? await letTheReefBoatsKitLapse(db, shop.id, now, shop.timezone)
      : null;

  const batchFour = await batchFourStates(params, db, shop, actor.id, now);
  const boatSlice = await boatAndMergeStates(request, db, shop.id, now);
  return NextResponse.json({
    ok: true,
    ...batchFour,
    ...boatSlice,
    ...(boatSafety ? { boatSafety } : {}),
    ...(introOverRatio ? { introOverRatio } : {}),
    ...(unitsNeedingCare ? { unitsNeedingCare } : {}),
    ...(blockedAboard ? { blockedAboard } : {}),
    ...(runningLate ? { runningLate } : {}),
    ...(blockedMinor ? { blockedMinor } : {}),
    ...(crewClash ? { crewClash } : {}),
    ...(crewClashSailed ? { crewClashSailed } : {}),
    ...(identityHeld ? { identityHeld } : {}),
    ...(moveBlocked ? { moveBlocked } : {}),
    ...(farStation ? { farStation } : {}),
    ...(droppedRental ? { droppedRental } : {}),
    ...(mixedBoat ? { mixedBoat } : {}),
  });
}
