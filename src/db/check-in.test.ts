import { and, eq, inArray, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seededShopContext } from "@/test/db";
import { checkInBooking, listCheckInQueue, listWalkInTrips, undoCheckInBooking } from "./check-in";
import { listDepartureBoardedBookingIds, recordRollCall } from "./manifests";
import { listTripsReadiness } from "./readiness";
import {
  activityEvents,
  bookingArrivalEvents,
  bookings,
  people,
  personRoles,
  priorVisits,
  rollCallEvents,
  trips,
  userAccounts,
} from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
const HOUR = 60 * 60 * 1000;

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const reef = trips.find((trip) => trip.title === "Two-Tank Reef — Molasses & French");
  if (!reef) throw new Error("seeded reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("seeded staff missing");
  const [booking] = await getTripRoster(db, shop.id, reef.id);
  if (!booking) throw new Error("seeded booking missing");
  return {
    db,
    shop,
    reef,
    staff: staff.person,
    booking: booking.booking,
    personName: booking.person.fullName,
  };
}

describe("counter check-in", () => {
  it("searches the bounded queue and keeps blocked divers out of check-in", async () => {
    const { db, shop } = await context();
    const queue = await listCheckInQueue(db, shop.id);
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((row) => ["booked", "checked_in"].includes(row.bookingStatus))).toBe(true);

    const searched = await listCheckInQueue(db, shop.id, { query: "Priya Sharma" });
    expect(searched).toHaveLength(1);
    expect(searched[0]?.readiness.status).toBe("blocked");
  });

  /**
   * **A check-in does not freeze readiness**, and the queue says so.
   *
   * `listTripsReadiness` excludes cancelled bookings and nothing else, so a
   * `checked_in` seat carries whatever readiness answers right now — and
   * between the counter and the dock it really does change: a refund lands, a
   * card is corrected, the captain moves the second tank to a deeper site. The
   * counter's own composition is built on this pair being possible
   * (`isSettledAtCounter`, `src/lib/check-in.ts`), so it is pinned here rather
   * than assumed.
   */
  it("carries a live blocker on a booking that has already checked in", async () => {
    const { db, shop } = await context();
    const [blocked] = await listCheckInQueue(db, shop.id, { query: "Priya Sharma" });
    if (!blocked) throw new Error("seeded blocked diver missing");
    expect(blocked.readiness.status).toBe("blocked");

    await db
      .update(bookings)
      .set({ status: "checked_in" })
      .where(eq(bookings.id, blocked.bookingId));

    const [afterCheckIn] = await listCheckInQueue(db, shop.id, { query: "Priya Sharma" });
    expect(afterCheckIn?.bookingStatus).toBe("checked_in");
    expect(afterCheckIn?.readiness.status).toBe("blocked");
  });

  /**
   * Two quiet facts the counter carries beside each name — never gates, and
   * both read in one batched pass over the queue rather than a query per row
   * (ADR 20260827-clearwater-surface-language, decision 9).
   */
  it("flags a diver with no usable emergency contact on file", async () => {
    const { db, shop } = await context();
    const queue = await listCheckInQueue(db, shop.id);
    const [subject] = queue;
    if (!subject) throw new Error("seeded queue empty");

    // A contact is only usable if the crew can dial it — a name with no number
    // reads as "on file" and is unreachable in an incident, so it counts as
    // missing (the same test Today's Contact rows apply).
    await db
      .update(people)
      .set({ emergencyContactName: "Ada Petrov", emergencyContactPhone: null })
      .where(eq(people.id, subject.personId));
    const nameOnly = await listCheckInQueue(db, shop.id, { query: subject.personName });
    expect(nameOnly[0]?.missingEmergencyContact).toBe(true);

    await db
      .update(people)
      .set({ emergencyContactName: "Ada Petrov", emergencyContactPhone: "+1 305 555 0142" })
      .where(eq(people.id, subject.personId));
    const reachable = await listCheckInQueue(db, shop.id, { query: subject.personName });
    expect(reachable[0]?.missingEmergencyContact).toBe(false);
  });

  it("greets a first visit, and never greets a regular whose history was imported", async () => {
    const { db, shop } = await context();
    const queue = await listCheckInQueue(db, shop.id);
    const [subject] = queue;
    if (!subject) throw new Error("seeded queue empty");

    // Nothing but this seat that counts: their first visit. Cancelled seats
    // are not visits — the same exclusion `src/db/recap.ts` applies.
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.personId, subject.personId), ne(bookings.id, subject.bookingId)));
    const first = await listCheckInQueue(db, shop.id, { query: subject.personName });
    expect(first[0]?.firstVisit).toBe(true);

    // **The failure this reader exists to prevent.** A ten-year regular whose
    // history arrived in a migration has no DiveDay booking behind them, and
    // counting native bookings alone would welcome them as a newcomer
    // (ADR 20260725-import-prior-visits; the merged-history semantics of
    // src/db/recap.ts).
    await db.insert(priorVisits).values({
      shopId: shop.id,
      personId: subject.personId,
      visitedOn: "2019-06-04",
      statusLabel: "Completed",
      dedupeKey: "prior-visit-completed",
      importedAt: nowDate(),
    });
    const migrated = await listCheckInQueue(db, shop.id, { query: subject.personName });
    expect(migrated[0]?.firstVisit).toBe(false);

    // A line the prior system itself marked as never having happened is not a
    // visit, and must not silently withhold the greeting either.
    await db.delete(priorVisits).where(eq(priorVisits.personId, subject.personId));
    await db.insert(priorVisits).values({
      shopId: shop.id,
      personId: subject.personId,
      visitedOn: "2019-06-04",
      statusLabel: "Cancelled",
      dedupeKey: "prior-visit-cancelled",
      importedAt: nowDate(),
    });
    const cancelledOnly = await listCheckInQueue(db, shop.id, { query: subject.personName });
    expect(cancelledOnly[0]?.firstVisit).toBe(true);
  });

  /**
   * **The constraint the first-visit count rests on.** `queueVisitHistory`
   * counts a diver's booking *rows* at or before this departure and calls a
   * lone one a first visit — which is the same thing as counting departures
   * only because `bookings_trip_person_unique` makes a second seat on one boat
   * impossible. A party is one row per person (each seat a name the organizer
   * typed, resolved to its own `people` row; ADR 20260804-seat-claim-links), so
   * a family of four on their first day is four first visits, not one diver
   * counted four times.
   *
   * Written after a 2026-08-28 review read the schema the other way — one row
   * per seat riding under the organizer's id — which would have made the
   * greeting vanish for exactly the party it exists for. If this constraint is
   * ever relaxed, that reading becomes correct and the reader has to count
   * distinct trips instead.
   */
  it("gives a diver at most one seat per departure, so a seat count is a departure count", async () => {
    const { db, shop, reef, booking } = await context();
    await expect(
      db.insert(bookings).values({
        shopId: shop.id,
        tripId: reef.id,
        personId: booking.personId,
        status: "booked",
      }),
    ).rejects.toThrow();

    const queue = await listCheckInQueue(db, shop.id);
    const seatsPerDiverPerBoat = new Map<string, number>();
    for (const row of queue) {
      const key = `${row.tripId}:${row.personId}`;
      seatsPerDiverPerBoat.set(key, (seatsPerDiverPerBoat.get(key) ?? 0) + 1);
    }
    expect([...seatsPerDiverPerBoat.values()].filter((seats) => seats > 1)).toEqual([]);
  });

  it("offers the same day-of trips for a walk-in as the check-in queue reads", async () => {
    const { db, shop, reef } = await context();
    const options = await listWalkInTrips(db, shop.id);
    expect(options.length).toBeGreaterThan(0);
    expect(options.map((o) => o.tripId)).toContain(reef.id);
    const reefOption = options.find((o) => o.tripId === reef.id);
    expect(reefOption?.capacity).toBe(reef.capacity);
    expect(reefOption?.booked).toBe(reef.booked);
  });

  it("excludes a departure that started more than an hour ago", async () => {
    const { db, shop, reef } = await context();
    const options = await listWalkInTrips(
      db,
      shop.id,
      new Date(reef.startsAt.getTime() + 60 * 60 * 1000 + 1000),
    );

    expect(options.map((option) => option.tripId)).not.toContain(reef.id);
  });

  it("includes a departure that starts exactly now (with 1-hour buffer)", async () => {
    const { db, shop, reef } = await context();
    const options = await listWalkInTrips(db, shop.id, reef.startsAt);

    expect(options.map((option) => option.tripId)).toContain(reef.id);
  });

  it("rechecks readiness, records a successful check-in, and is idempotent", async () => {
    const { db, shop, staff, booking, personName } = await context();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    await completeWaiver(db, issued.token, {
      signerName: personName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const outcome = await checkInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
    });
    expect(outcome).toMatchObject({ ok: true, bookingId: booking.id });

    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("checked_in");

    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toMatchObject({ ok: true, duplicate: true });
  });

  it("shows a diver as boarded once roll call records them, independent of counter check-in (task 149)", async () => {
    // Check-in and boarding are two different questions — arrived vs.
    // aboard. The check-in queue's own description promises this split, but
    // the queue never actually showed boarding before task 149.
    const { db, shop, reef, staff, booking, personName } = await context();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    await completeWaiver(db, issued.token, {
      signerName: personName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const beforeBoarding = await listCheckInQueue(db, shop.id, { query: personName });
    expect(beforeBoarding[0]?.boarded).toBe(false);

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    const afterBoarding = await listCheckInQueue(db, shop.id, { query: personName });
    // Boarded on the manifest, but never checked in at the counter — the two
    // states stay independent rather than one implying the other.
    expect(afterBoarding[0]?.boarded).toBe(true);
    expect(afterBoarding[0]?.bookingStatus).toBe("booked");
    // The wider question the no-show door is drawn on agrees with the badge
    // here, because a dock boarding satisfies both.
    expect(afterBoarding[0]?.onTheWater).toBe("boarded");
  });

  /**
   * **The queue row that decides whether "Did not dive?" is drawn**
   * (dive-domain-expert review, issue #1704).
   *
   * The badge above is the dock, and it is right to be: it says the crew
   * counted this diver onto the boat. The gate asks a wider question, and for
   * one slice it was handed the badge's narrower answer — so the counter drew
   * the door over a diver the crew had recorded as not back aboard after a
   * dive, and the writer then refused the tap. No seat was ever lost; the app
   * spent two taps inviting the desk to write off a missing person.
   *
   * No waiver on this seat, deliberately: readiness gates the boarded tap at
   * the dock and nothing else, so the after-dive result is recordable here.
   */
  it("tells the no-show door a diver missing after a dive is on the water", async () => {
    const { db, shop, reef, staff, booking, personName } = await context();

    const before = await listCheckInQueue(db, shop.id, { query: personName });
    expect(before[0]?.onTheWater).toBeNull();

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true });

    const after = await listCheckInQueue(db, shop.id, { query: personName });
    expect(after[0]?.onTheWater).toBe("missing_after_dive");
    // The dock badge stays false, which is the point of keeping them apart:
    // this diver has no departure result at all.
    expect(after[0]?.boarded).toBe(false);
  });

  /**
   * And the dock's own `not_boarded` leaves the door open, because there the
   * word means "never left the dock" — the ordinary walk-away the counter
   * exists to record. A row that read `not_boarded` without its checkpoint
   * would close the door on every one of them.
   */
  it("leaves the no-show door open for a diver the crew marked ashore at the dock", async () => {
    const { db, shop, reef, staff, booking, personName } = await context();

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        status: "not_boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    const queue = await listCheckInQueue(db, shop.id, { query: personName });
    expect(queue[0]?.onTheWater).toBeNull();
  });

  it("refuses a cross-tenant booking or non-staff actor", async () => {
    const { db, booking } = await context();
    await expect(
      checkInBooking(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId: booking.id,
        recordedByPersonId: "00000000-0000-4000-8000-000000000000",
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });
  });

  it("refuses to check in a booking that is not ready, carrying the trip id for the guest-row link", async () => {
    const { db, shop, staff, booking } = await context();
    const outcome = await checkInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
    });
    // The staff `not_ready` notice links straight to the diver's guest row
    // (checkIn.notice.notReady, task 70) — that link needs the trip id, not
    // just the refusal reason.
    expect(outcome).toMatchObject({ ok: false, reason: "not_ready", tripId: booking.tripId });
  });

  it("undoes a check-in with its own trail event, idempotently, and only for live staff", async () => {
    const { db, shop, staff, booking, personName } = await context();
    /**
     * How many lines this seat already carries, read before the acts below.
     *
     * A **delta**, not an absolute count: this is the seeded shop's busiest
     * seat — the first booking on today's reef boat — and the demo's own desk
     * trail writes against it (`seed-desk-trail.ts`, `seed-diver-trail.ts`).
     * Asserting `toHaveLength(2)` made this test a tripwire on how much history
     * the demo happens to carry, which is not what it is about: what it pins is
     * that a check-in and its correction are *two* events, and that a refused
     * undo adds none.
     */
    const trailCount = async () =>
      (await db.select().from(activityEvents).where(eq(activityEvents.bookingId, booking.id)))
        .length;
    const before = await trailCount();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    await completeWaiver(db, issued.token, {
      signerName: personName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await expect(
      checkInBooking(db, { shopId: shop.id, bookingId: booking.id, recordedByPersonId: staff.id }),
    ).resolves.toMatchObject({ ok: true });

    const undone = await undoCheckInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
    });
    expect(undone).toMatchObject({ ok: true, bookingId: booking.id });

    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("booked");

    // The correction is its own event — the trail keeps both taps, never
    // deletes one (design principle 7's re-tap contract).
    expect(await trailCount()).toBe(before + 2);

    // A double-tap (a second device, a stale tab) finds the work already done.
    await expect(
      undoCheckInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toMatchObject({ ok: true, duplicate: true });

    // Same defence-in-depth gate as the check-in writer: a non-staff actor is
    // refused and the trail stays exactly as it was.
    await expect(
      undoCheckInBooking(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId: booking.id,
        recordedByPersonId: "00000000-0000-4000-8000-000000000000",
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });
    expect(await trailCount()).toBe(before + 2);
  });

  it("refuses to undo a booking that is cancelled rather than checked in", async () => {
    const { db, shop, staff, booking } = await context();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    await expect(
      undoCheckInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toEqual({ ok: false, reason: "not_checked_in" });
    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("cancelled");
  });

  it("queries readiness for multiple trips at once using listTripsReadiness", async () => {
    const { db, shop, reef } = await context();
    const results = await listTripsReadiness(db, shop.id, [reef.id]);
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.find((r) => r.booking.tripId === reef.id)).toBeDefined();
  });
});

/**
 * Security review of the live-roles work, following 40d0a09's fix to the three
 * roll-call writers in `src/db/manifests.ts`. This writer authorized its
 * recorder with the same hand-rolled `person_roles` join — `people.id` /
 * `people.shopId` / `person_roles.role`, here against a local copy of
 * `STAFF_ROLES` — and checked neither `people.deleted_at` nor
 * `user_accounts.status`. So the two cases `loadActiveStaffRoles` exists for
 * both got through:
 *
 * - a **deleted** person, because `deleteDiver` sets `people.deleted_at` and
 *   leaves every role row exactly where it is;
 * - a **disabled** account, because `setStaffAccountStatus` revokes sign-in and
 *   leaves `person_roles` entirely intact — a suspended employee keeps every
 *   role row they had.
 *
 * Both moved a real booking to `checked_in` and signed the `activity_events`
 * trail with their name. Each test below therefore asserts the refusal *and*
 * that the booking never moved and the trail stayed empty: a refusal that still
 * wrote the row would be no fix at all, because the trail is what a shop reads
 * back to reconstruct who did what at the counter.
 *
 * The refusal stays the writer's existing `staff_not_found` — `checkInAction`
 * already redirects any refusal to `?notice=<reason>`, so the vocabulary is a
 * notice key that is already worded.
 */
describe("the counter check-in recorder must be live staff (defence in depth)", () => {
  /** A booking readiness has already cleared, so only the staff gate is left. */
  async function readyContext() {
    const base = await context();
    const issued = await issueWaiverRequest(base.db, {
      shopId: base.shop.id,
      bookingId: base.booking.id,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(base.db, issued.token, {
      signerName: base.personName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    /**
     * The lines this seat already carries, recorded once so the assertions
     * below can speak about what *these calls* wrote.
     *
     * This is the seeded shop's busiest seat — the first booking on today's
     * reef boat — and the demo writes real desk history against it
     * (`seed-desk-trail.ts`, `seed-diver-trail.ts`). Asserting an empty trail
     * outright made these tests a tripwire on how much history the demo happens
     * to carry, which is not what they are about: what they pin is that a
     * refused check-in writes **nothing**, and a permitted one writes exactly
     * one line.
     */
    const before = new Set(
      (
        await base.db
          .select({ id: activityEvents.id })
          .from(activityEvents)
          .where(eq(activityEvents.bookingId, base.booking.id))
      ).map((row) => row.id),
    );
    return { ...base, before };
  }

  async function trailFor(
    db: Awaited<ReturnType<typeof context>>["db"],
    bookingId: string,
    before: Set<string>,
  ) {
    const rows = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.bookingId, bookingId));
    return rows.filter((row) => !before.has(row.id));
  }

  async function statusOf(db: Awaited<ReturnType<typeof context>>["db"], bookingId: string) {
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    return row?.status;
  }

  it("refuses a deleted person, and checks nobody in", async () => {
    const { db, shop, staff, booking, before } = await readyContext();
    // `deleteDiver`'s soft delete, which touches nothing but this column — the
    // staff roles that authorized them are all still sitting there.
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, staff.id));

    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

    expect(await statusOf(db, booking.id)).toBe("booked");
    expect(await trailFor(db, booking.id, before)).toEqual([]);
  });

  it("refuses a disabled account still holding a stale role row, and checks nobody in", async () => {
    const { db, shop, staff, booking, before } = await readyContext();
    // Access revoked, roster row intact — what `setStaffAccountStatus` leaves
    // behind. Sign-in already refuses this account; until now the writer did not.
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, staff.id));
    // The stale role row is the whole point of the case, so prove it is there.
    expect(
      await db.select().from(personRoles).where(eq(personRoles.personId, staff.id)),
    ).not.toEqual([]);

    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });

    expect(await statusOf(db, booking.id)).toBe("booked");
    expect(await trailFor(db, booking.id, before)).toEqual([]);
  });

  it("still lets live staff check in, and still refuses one demoted to diver", async () => {
    const { db, shop, staff, booking, before } = await readyContext();
    // The control for both refusals above: same shop, same booking, same call —
    // only the recorder's standing differs.
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toMatchObject({ ok: true, bookingId: booking.id });
    expect(await statusOf(db, booking.id)).toBe("checked_in");
    expect(await trailFor(db, booking.id, before)).toMatchObject([{ actorPersonId: staff.id }]);

    // Demotion is the case the hand-rolled join did catch, and the rewrite must
    // keep catching it: every staff role gone, a `diver` row left. The gate runs
    // before the already-checked-in short-circuit, so the answer is the refusal
    // rather than the cheerful `duplicate` a second tap would otherwise get.
    await db
      .delete(personRoles)
      .where(and(eq(personRoles.personId, staff.id), inArray(personRoles.role, [...STAFF_ROLES])));
    await db.insert(personRoles).values({ personId: staff.id, role: "diver" });

    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });
    // Still just the one entry the live staff member wrote.
    expect(await trailFor(db, booking.id, before)).toHaveLength(1);
  });
});

/**
 * **The counter with no signal** (ADR 20260907-the-counter-survives-offline).
 *
 * Every test here drives the *same* two functions the live counter drives,
 * with `source: "offline"` and the three fields a queue carries. That is the
 * point of the design, so it is the shape of the coverage: what the offline
 * branch adds is idempotency, a staleness bound and two orderings, and each of
 * them is a way a queued tap can be wrong hours after somebody made it.
 */
describe("a counter arrival queued with no signal", () => {
  const MINUTE = 60 * 1000;

  /** A seat whose waiver is signed, so readiness clears it. */
  async function readySeat() {
    const ctx = await context();
    const issued = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
    });
    if (!issued.ok) throw new Error("waiver request refused");
    await completeWaiver(ctx.db, issued.token, {
      signerName: ctx.personName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    return ctx;
  }

  /**
   * One queued tap's three offline fields, plausible by construction: the
   * copy was saved ten minutes before the tap, which is the order
   * `offlineEventOutOfBounds` requires. Overriding `occurredAt` moves the
   * saved time with it, so a test that means to move the *tap* does not
   * accidentally test the staleness bound instead.
   */
  function queued(overrides: { occurredAt?: Date; clientEventId?: string } = {}) {
    const occurredAt = overrides.occurredAt ?? new Date(nowDate().getTime() - 30 * MINUTE);
    return {
      source: "offline" as const,
      clientEventId: "clientEventId" in overrides ? overrides.clientEventId : crypto.randomUUID(),
      occurredAt,
      offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 10 * MINUTE),
    };
  }

  it("applies a queued arrival, and applies it exactly once however often it is retried", async () => {
    const { db, shop, staff, booking } = await readySeat();
    const event = queued();

    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...event,
      }),
    ).resolves.toMatchObject({ ok: true, bookingId: booking.id });

    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("checked_in");

    // The sync response never reached the boat and the batch was sent again.
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...event,
      }),
    ).resolves.toMatchObject({ ok: true, duplicate: true });

    const trail = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ status: "arrived", source: "offline" });
    expect(trail[0]?.clientEventId).toBe(event.clientEventId);
  });

  /**
   * The one rule this whole feature is built around: *an arrival is never
   * promoted to aboard by the queue.* Asserted against the tables rather than
   * against a code path, because a code path can be rewritten and this is the
   * property that must survive the rewrite.
   */
  it("puts nobody on a boat — a queued arrival writes no roll-call row at all", async () => {
    const { db, shop, reef, staff, booking } = await readySeat();
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued(),
      }),
    ).resolves.toMatchObject({ ok: true });

    const boarded = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);
    expect(boarded.has(booking.id)).toBe(false);
    const rollCall = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.bookingId, booking.id));
    expect(rollCall).toHaveLength(0);
    const [queue] = await listCheckInQueue(db, shop.id, { query: booking.id });
    expect(queue).toMatchObject({ bookingStatus: "checked_in", boarded: false });
  });

  /**
   * **Readiness is re-read when the batch lands, not when the tap happened.**
   * A device holding a copy up to a fortnight old cannot know that a refund
   * landed or a card expired since; the server can, and refuses.
   */
  it("refuses a queued arrival for a diver readiness no longer clears", async () => {
    const { db, shop, staff, booking } = await context();
    const outcome = await checkInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
      ...queued(),
    });
    expect(outcome).toMatchObject({ ok: false, reason: "not_ready" });
    const trail = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    expect(trail).toHaveLength(0);
  });

  it("refuses a tap whose own clocks put it outside the plausible window", async () => {
    const { db, shop, staff, booking } = await readySeat();
    const occurredAt = new Date(nowDate().getTime() - 30 * MINUTE);
    // A copy that claims to have been saved *after* the tap taken from it.
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued({ occurredAt }),
        offlineSnapshotSavedAt: new Date(occurredAt.getTime() + HOUR),
      }),
    ).resolves.toEqual({ ok: false, reason: "snapshot_invalid" });

    // A tap stamped in the future.
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued({ occurredAt: new Date(nowDate().getTime() + HOUR) }),
      }),
    ).resolves.toEqual({ ok: false, reason: "snapshot_invalid" });

    // And one with no idempotency key at all, which cannot be applied safely.
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued({ clientEventId: undefined }),
      }),
    ).resolves.toEqual({ ok: false, reason: "snapshot_invalid" });
  });

  /**
   * Two devices, one seat. The desk's own undo is recorded live at 09:00; a
   * tablet that has been out of signal since 08:00 syncs an arrival stamped
   * 08:30. The older statement loses.
   */
  it("refuses a queued arrival older than the statement already standing", async () => {
    const { db, shop, staff, booking } = await readySeat();
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      undoCheckInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued({ occurredAt: new Date(nowDate().getTime() - 2 * HOUR) }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "newer_event_exists" });

    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("booked");
  });

  /**
   * The compare-and-set, reproduced at the counter (ADR
   * 20260815-an-offline-retraction-names-its-target).
   *
   * The tablet's own arrival is synced. The desk then undoes it and checks the
   * diver back in, because they were standing there. The tablet, still holding
   * the copy it had, queues an undo of *its own* arrival. Its timestamp beats
   * the desk's — a retraction is stamped at tap time — so the plain
   * newest-wins comparison lets it through. The compare-and-set does not: the
   * arrival it names is no longer the statement standing.
   */
  it("refuses an undo whose arrival is no longer the statement standing", async () => {
    const { db, shop, staff, booking } = await readySeat();
    const arrival = queued({ occurredAt: new Date(nowDate().getTime() - 3 * HOUR) });
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...arrival,
      }),
    ).resolves.toMatchObject({ ok: true });

    // The desk, live, with the diver in front of them.
    await expect(
      undoCheckInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        now: new Date(nowDate().getTime() - 2 * HOUR),
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        now: new Date(nowDate().getTime() - 2 * HOUR),
      }),
    ).resolves.toMatchObject({ ok: true });

    const outcome = await undoCheckInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
      ...queued({ occurredAt: new Date(nowDate().getTime() - MINUTE) }),
      retractsClientEventId: arrival.clientEventId,
    });
    expect(outcome).toEqual({ ok: false, reason: "retraction_superseded" });

    // The desk's sighting stands. The diver is still checked in.
    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("checked_in");
  });

  it("applies an undo that still names the statement standing", async () => {
    const { db, shop, staff, booking } = await readySeat();
    const arrival = queued({ occurredAt: new Date(nowDate().getTime() - 3 * HOUR) });
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...arrival,
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      undoCheckInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued({ occurredAt: new Date(nowDate().getTime() - MINUTE) }),
        retractsClientEventId: arrival.clientEventId,
      }),
    ).resolves.toMatchObject({ ok: true });

    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("booked");
  });

  /**
   * An undo that names nothing keeps the pre-change path, exactly as roll
   * call's does: it was queued by a build that predates the field, on a phone
   * in a dry bag, and refusing it would discard a correction a staffer really
   * made.
   */
  it("still applies an undo that names no arrival", async () => {
    const { db, shop, staff, booking } = await readySeat();
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued({ occurredAt: new Date(nowDate().getTime() - 3 * HOUR) }),
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      undoCheckInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued({ occurredAt: new Date(nowDate().getTime() - MINUTE) }),
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  /** A queued tap from a device signed into another shop reaches nothing here. */
  it("refuses a queued arrival scoped to another tenant", async () => {
    const { db, booking } = await readySeat();
    await expect(
      checkInBooking(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId: booking.id,
        recordedByPersonId: "00000000-0000-4000-8000-000000000000",
        ...queued(),
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });
  });

  /**
   * Every tap leaves a row, live ones included — the fact the two orderings
   * above have nothing to compare against without.
   */
  it("records a live check-in in the same trail, marked live", async () => {
    const { db, shop, staff, booking } = await readySeat();
    await checkInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
    });
    await undoCheckInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
    });
    const trail = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id))
      .orderBy(bookingArrivalEvents.seq);
    expect(trail.map((row) => row.status)).toEqual(["arrived", "cleared"]);
    expect(trail.every((row) => row.source === "live" && row.clientEventId === null)).toBe(true);
  });

  /**
   * **The ordinary bad morning**: somebody is checked in at the desk with no
   * signal, and cancels before the tablet finds a bar. Readiness is not the
   * only thing that can refuse a queued arrival, and this is the refusal a
   * shop meets most often (domain review, 2026-09-07).
   */
  it("refuses a queued arrival for a seat cancelled while the device was dark", async () => {
    const { db, shop, staff, booking } = await readySeat();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));

    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued(),
      }),
    ).resolves.toEqual({ ok: false, reason: "not_bookable" });

    const trail = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    expect(trail).toHaveLength(0);
  });

  /**
   * **The ADR's sailed-departure decision, pinned.**
   * (`20260907-the-counter-survives-offline`, Consequences.) `checkInBooking`
   * asks only whether the trip is still `scheduled` — the same question it
   * asks a staffer at the desk — so a tap made before the boat left applies
   * when the batch lands after it. Checking somebody in once the boat has gone
   * is meaningless rather than dangerous: it closes an arrival queue and says
   * nothing about who is aboard. A test rather than a paragraph, because the
   * obvious "fix" is a second time gate the live counter does not have.
   */
  it("applies a queued arrival for a departure that has already sailed", async () => {
    const { db, shop, reef, staff, booking } = await readySeat();
    await db
      .update(trips)
      .set({ startsAt: new Date(nowDate().getTime() - 3 * HOUR) })
      .where(eq(trips.id, reef.id));

    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued(),
      }),
    ).resolves.toMatchObject({ ok: true, bookingId: booking.id });

    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("checked_in");
  });

  /**
   * **Two devices greeting the same diver.** Distinct idempotency keys, so the
   * `client_event_id` dedup cannot see the second one; the `checked_in` guard
   * catches it instead and answers success without writing.
   *
   * That is the sentence the ADR now carries rather than the one it used to:
   * every tap that *changes the seat* writes a row, and a tap that changes
   * nothing writes nothing.
   */
  it("greets a diver once when two devices both queue an arrival for them", async () => {
    const { db, shop, staff, booking } = await readySeat();

    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued(),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      await db
        .select()
        .from(bookingArrivalEvents)
        .where(eq(bookingArrivalEvents.bookingId, booking.id)),
    ).toHaveLength(1);

    // The second tablet's own key, minted independently — not a retry.
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued(),
      }),
    ).resolves.toMatchObject({ ok: true, duplicate: true });

    const trail = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    expect(trail).toHaveLength(1);
  });

  /**
   * **Aboard outranks the desk.** A tablet that lost signal at 07:40 queues
   * "this diver never turned up"; the crew records them onto the boat at 08:50;
   * the batch syncs at 11:00. Applied, it would put a diver who is on a reef
   * back on the counter's *still to come* list and somebody would ring a phone
   * in a dry bag.
   *
   * A **read** of roll call, never a write — the invariant that no arrival
   * path can reach `roll_call_events` is untouched, and asserted below.
   */
  it("refuses an offline retraction for a diver the rail has recorded aboard", async () => {
    const { db, shop, reef, staff, booking } = await readySeat();
    // The arrival, at 07:40 on the device's own clock.
    const arrival = queued({ occurredAt: new Date(nowDate().getTime() - 40 * MINUTE) });
    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...arrival,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    // The retraction is newer than the arrival and names it, so it clears both
    // orderings above and reaches the one this test is about. Without the
    // boarding check it would apply.
    await expect(
      undoCheckInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        ...queued({ occurredAt: new Date(nowDate().getTime() - 20 * MINUTE) }),
        retractsClientEventId: arrival.clientEventId,
      }),
    ).resolves.toEqual({ ok: false, reason: "boarded" });

    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("checked_in");
    const arrivals = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    expect(arrivals.map((row) => row.status)).toEqual(["arrived"]);
    // The refusal read roll call and wrote nothing there.
    expect(
      await db.select().from(rollCallEvents).where(eq(rollCallEvents.bookingId, booking.id)),
    ).toHaveLength(1);
  });

  /**
   * The other half of the same rule, and the reason it is scoped to `offline`:
   * a staffer undoing a live check-in is looking at the person, so the live
   * counter keeps the power it has today even for a diver already aboard.
   */
  it("still lets a staffer at the desk undo a check-in for a boarded diver", async () => {
    const { db, shop, reef, staff, booking } = await readySeat();
    await checkInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
    });

    await expect(
      undoCheckInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toMatchObject({ ok: true, bookingId: booking.id });
  });
});
