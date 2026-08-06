import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { checkInBooking, listCheckInQueue, listWalkInTrips } from "./check-in";
import { recordRollCall } from "./manifests";
import { listTripsReadiness } from "./readiness";
import { activityEvents, bookings, people, personRoles, userAccounts } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const clearAnswers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

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

  it("offers the same day-of trips for a walk-in as the check-in queue reads", async () => {
    const { db, shop, reef } = await context();
    const options = await listWalkInTrips(db, shop.id);
    expect(options.length).toBeGreaterThan(0);
    expect(options.map((o) => o.tripId)).toContain(reef.id);
    const reefOption = options.find((o) => o.tripId === reef.id);
    expect(reefOption?.capacity).toBe(reef.capacity);
    expect(reefOption?.booked).toBe(reef.booked);
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
    return base;
  }

  async function trailFor(db: Awaited<ReturnType<typeof context>>["db"], bookingId: string) {
    return db.select().from(activityEvents).where(eq(activityEvents.bookingId, bookingId));
  }

  async function statusOf(db: Awaited<ReturnType<typeof context>>["db"], bookingId: string) {
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    return row?.status;
  }

  it("refuses a deleted person, and checks nobody in", async () => {
    const { db, shop, staff, booking } = await readyContext();
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
    expect(await trailFor(db, booking.id)).toEqual([]);
  });

  it("refuses a disabled account still holding a stale role row, and checks nobody in", async () => {
    const { db, shop, staff, booking } = await readyContext();
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
    expect(await trailFor(db, booking.id)).toEqual([]);
  });

  it("still lets live staff check in, and still refuses one demoted to diver", async () => {
    const { db, shop, staff, booking } = await readyContext();
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
    expect(await trailFor(db, booking.id)).toMatchObject([{ actorPersonId: staff.id }]);

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
    expect(await trailFor(db, booking.id)).toHaveLength(1);
  });
});
