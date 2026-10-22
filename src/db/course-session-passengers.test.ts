// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import type { ParticipantType } from "@/lib/participant-types";
import { fileScopedShopContext } from "@/test/db";
import { createBooking, setBookingParticipantType } from "./bookings";
import { listCourseSeatsInTraining } from "./certifications-in-training";
import type { AppDb } from "./client";
import { tripRatioGapNeedsInstructor } from "./crew-requests";
import { departureOpenToDiver, invitableSeats } from "./interest-offers";
import { markBookingNoShow, undoBookingNoShow } from "./no-show";
import {
  issueShopCertification,
  issueShopNitroxCertification,
  issueShopSpecialtyCertification,
  studentOnSeat,
} from "./readiness";
import { bookings, courses, people, shops, trips } from "./schema";
import { createTrip, listStaff, setTripCrew, setTripParticipantTerms } from "./trips";
import { getTripOverview } from "./trips-overview";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **A course session's students are its divers; a priced snorkeler or rider
 * may ride beside them** (issue #2226, Aaron 2026-10-13, ADR
 * 20261007-participant-types as amended).
 *
 * Adversarial throughout: every test asks whether a non-diver seat is a way
 * to get a student aboard without the course's gates, or a way for a
 * passenger to count as someone in training.
 */

/** 200 days out: clear of the seeded instructor's calendar whatever the hour. */
const OFFSET_MS = 200 * 24 * 60 * 60 * 1000;

let seq = 0;

async function session(db: AppDb, shopId: string, courseTitle: string) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.title, courseTitle)));
  if (!course) throw new Error(`${courseTitle} missing`);
  const staff = await listStaff(db, shopId);
  const instructor = staff.find((entry) => entry.roles.includes("instructor"));
  if (!instructor) throw new Error("seeded instructor missing");
  seq += 1;
  const startsAt = nowMs() + OFFSET_MS + seq * 6 * 60 * 60 * 1000;
  const trip = await createTrip(db, {
    shopId,
    courseId: course.id,
    title: `${courseTitle} — passengers ${seq}`,
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt + 4 * 60 * 60 * 1000),
    capacity: 12,
    plannedDives: 2,
  });
  if (!trip) throw new Error("session not created");
  if (!(await setTripCrew(db, shopId, trip.id, [instructor.person.id]))) {
    throw new Error("instructor not assigned");
  }
  return { trip, course, staff: instructor.person };
}

async function seat(
  db: AppDb,
  shopId: string,
  tripId: string,
  participantType: ParticipantType,
  actor: "staff" | "public" = "staff",
) {
  seq += 1;
  return createBooking(db, {
    actor,
    shopId,
    tripId,
    participantType,
    fullName: `Passenger ${seq}`,
    email: `passenger-${seq}@example.com`,
  });
}

async function priceRiders(db: AppDb, shopId: string, tripId: string) {
  expect(
    await setTripParticipantTerms(db, shopId, tripId, {
      snorkelerPriceCents: null,
      riderPriceCents: 2_500,
      diverCapacity: null,
    }),
  ).toEqual({ ok: true });
}

describe("a non-diver seat on a course session", () => {
  it("is refused unpriced from either door, and books once the shop names a price", async () => {
    const { db, shop } = ctx;
    const { trip } = await session(db, shop.id, "Advanced Open Water Diver");
    for (const actor of ["staff", "public"] as const) {
      expect(await seat(db, shop.id, trip.id, "rider", actor)).toMatchObject({
        ok: false,
        reason: "participant_type_unavailable",
      });
    }
    await priceRiders(db, shop.id, trip.id);
    for (const actor of ["staff", "public"] as const) {
      expect(await seat(db, shop.id, trip.id, "rider", actor)).toMatchObject({ ok: true });
    }
    // Still unpriced: the snorkeler's seat stays shut.
    expect(await seat(db, shop.id, trip.id, "snorkeler")).toMatchObject({
      ok: false,
      reason: "participant_type_unavailable",
    });
  });

  it("asks the rider none of the course's card gate, and still asks every student", async () => {
    const { db, shop } = ctx;
    // Advanced asks for an Open Water card the walk-in does not have.
    const { trip } = await session(db, shop.id, "Advanced Open Water Diver");
    await priceRiders(db, shop.id, trip.id);
    expect(await seat(db, shop.id, trip.id, "diver")).toMatchObject({
      ok: false,
      reason: "course_prerequisite",
    });
    expect(await seat(db, shop.id, trip.id, "rider")).toMatchObject({ ok: true });
  });

  it("counts against the boat and never against the students' ratio", async () => {
    const { db, shop } = ctx;
    // An intro session on one instructor: the ratio caps the students.
    const { trip } = await session(db, shop.id, "Discover Scuba Diving");
    await priceRiders(db, shop.id, trip.id);
    let students = 0;
    for (;;) {
      const outcome = await seat(db, shop.id, trip.id, "diver");
      if (!outcome.ok) {
        expect(outcome).toMatchObject({ reason: "course_ratio_full" });
        break;
      }
      students += 1;
      if (students > 12) throw new Error("ratio never bound");
    }
    expect(students).toBeGreaterThan(0);
    expect(await seat(db, shop.id, trip.id, "rider")).toMatchObject({ ok: true });
    // And the rider did not take a student's place.
    expect(await seat(db, shop.id, trip.id, "diver")).toMatchObject({
      ok: false,
      reason: "course_ratio_full",
    });
  });

  it("is never in training for the level the course certifies", async () => {
    const { db, shop } = ctx;
    const { trip } = await session(db, shop.id, "Open Water Diver");
    await priceRiders(db, shop.id, trip.id);
    const rider = await seat(db, shop.id, trip.id, "rider");
    const student = await seat(db, shop.id, trip.id, "diver");
    if (!rider.ok || !student.ok) throw new Error("setup failed");
    const ids = await db
      .select({ id: bookings.id, personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.tripId, trip.id));
    const personOf = (bookingId: string) => ids.find((row) => row.id === bookingId)?.personId;
    const riderPerson = personOf(rider.bookingId);
    const studentPerson = personOf(student.bookingId);
    if (!riderPerson || !studentPerson) throw new Error("people missing");

    const seats = await listCourseSeatsInTraining(db, shop.id, [riderPerson, studentPerson]);
    expect(seats.map((row) => row.personId)).toEqual([studentPerson]);
    expect(await studentOnSeat(db, shop.id, trip.id, rider.bookingId)).toBeNull();
    expect(await studentOnSeat(db, shop.id, trip.id, student.bookingId)).toBe(studentPerson);
  });
});

describe("a type change on a course session", () => {
  it("never takes a student out of the water, nor puts a passenger in it", async () => {
    const { db, shop } = ctx;
    const { trip, staff } = await session(db, shop.id, "Open Water Diver");
    await priceRiders(db, shop.id, trip.id);
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    const student = await seat(db, shop.id, trip.id, "diver");
    const rider = await seat(db, shop.id, trip.id, "rider");
    if (!student.ok || !rider.ok) throw new Error("setup failed");

    expect(
      await setBookingParticipantType(db, { ...ids, bookingId: student.bookingId, to: "rider" }),
    ).toMatchObject({ ok: false, reason: "participant_type_unavailable" });
    // "Change anyway" is a card override; it is no way around enrollment.
    expect(
      await setBookingParticipantType(db, {
        ...ids,
        bookingId: rider.bookingId,
        to: "diver",
        confirmCertBlock: true,
      }),
    ).toMatchObject({ ok: false, reason: "participant_type_unavailable" });
  });

  it("moves a rider to snorkeling only once the session prices it", async () => {
    const { db, shop } = ctx;
    const { trip, staff } = await session(db, shop.id, "Open Water Diver");
    await priceRiders(db, shop.id, trip.id);
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    const rider = await seat(db, shop.id, trip.id, "rider");
    if (!rider.ok) throw new Error("setup failed");

    expect(
      await setBookingParticipantType(db, { ...ids, bookingId: rider.bookingId, to: "snorkeler" }),
    ).toMatchObject({ ok: false, reason: "participant_type_unavailable" });
    await setTripParticipantTerms(db, shop.id, trip.id, {
      snorkelerPriceCents: 4_000,
      riderPriceCents: 2_500,
      diverCapacity: null,
    });
    expect(
      await setBookingParticipantType(db, { ...ids, bookingId: rider.bookingId, to: "snorkeler" }),
    ).toMatchObject({ ok: true, changed: true });
  });
});

/**
 * **A card lands only on the student the seat holds** (reviews G4/Y2 of
 * #2226): the roster's Certify posts a booking, and the person is read from
 * that diver's seat, never from the form. Every writer refuses a person whose
 * seat on the session is a passenger's, or held over who they are.
 */
describe("a shop-issued card on a course session", () => {
  it("is refused for a passenger, at every writer, and writes no row", async () => {
    const { db, shop } = ctx;
    const { trip, staff } = await session(db, shop.id, "Open Water Diver");
    await priceRiders(db, shop.id, trip.id);
    const rider = await seat(db, shop.id, trip.id, "rider");
    if (!rider.ok) throw new Error("setup failed");
    const [row] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, rider.bookingId));
    if (!row) throw new Error("rider missing");
    const issued = {
      shopId: shop.id,
      personId: row.personId,
      tripId: trip.id,
      issuedByPersonId: staff.id,
    };
    expect(await issueShopCertification(db, { ...issued, level: "open_water" })).toBeNull();
    expect(await issueShopSpecialtyCertification(db, { ...issued, specialty: "deep" })).toBeNull();
    expect(await issueShopNitroxCertification(db, issued)).toBeNull();
  });

  it("names nobody for a seat on another departure, or another shop's", async () => {
    const { db, shop } = ctx;
    const { trip } = await session(db, shop.id, "Open Water Diver");
    const other = await session(db, shop.id, "Open Water Diver");
    const student = await seat(db, shop.id, trip.id, "diver");
    if (!student.ok) throw new Error("setup failed");
    expect(await studentOnSeat(db, shop.id, other.trip.id, student.bookingId)).toBeNull();
    expect(
      await studentOnSeat(db, "00000000-0000-0000-0000-000000000000", trip.id, student.bookingId),
    ).toBeNull();
  });

  it("is refused for a seat held over who the student is", async () => {
    const { db, shop } = ctx;
    const { trip, staff } = await session(db, shop.id, "Open Water Diver");
    const student = await seat(db, shop.id, trip.id, "diver");
    if (!student.ok) throw new Error("setup failed");
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Someone Else" })
      .where(eq(bookings.id, student.bookingId));
    const [row] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, student.bookingId));
    if (!row) throw new Error("student missing");
    expect(await studentOnSeat(db, shop.id, trip.id, student.bookingId)).toBeNull();
    expect(
      await issueShopCertification(db, {
        shopId: shop.id,
        personId: row.personId,
        tripId: trip.id,
        issuedByPersonId: staff.id,
        level: "open_water",
      }),
    ).toBeNull();
  });
});

/**
 * **A priced passenger never fills the students' ratio** (agency review G5 of
 * #2226): every reader of a course session's ratio counts its divers, so a
 * rider beside a full class neither shuts the class's last place nor reads
 * as a session over its ratio.
 */
describe("the ratio beside priced passengers", () => {
  /** An intro session with one instructor, its class full, one student cancelled, riders aboard. */
  async function classWithRiders() {
    const { db, shop } = ctx;
    const { trip, staff } = await session(db, shop.id, "Discover Scuba Diving");
    await priceRiders(db, shop.id, trip.id);
    const students: string[] = [];
    for (;;) {
      const outcome = await seat(db, shop.id, trip.id, "diver");
      if (!outcome.ok) break;
      students.push(outcome.bookingId);
      if (students.length > 12) throw new Error("ratio never bound");
    }
    const [freed] = students;
    if (!freed) throw new Error("no student seated");
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, freed));
    for (const _ of [1, 2]) {
      const rider = await seat(db, shop.id, trip.id, "rider");
      if (!rider.ok) throw new Error("rider refused");
    }
    return { db, shop, trip, staff, students };
  }

  it("keeps the class's free place open to a diver from a link", async () => {
    const { db, shop, trip } = await classWithRiders();
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Walk In", email: "ratio-walk-in@example.com" })
      .returning({ id: people.id });
    if (!person) throw new Error("person insert failed");
    expect(
      await departureOpenToDiver(db, { shopId: shop.id, tripId: trip.id, personId: person.id }),
    ).toBe(true);
  });

  it("counts the free place for the wait list", async () => {
    const { db, trip } = await classWithRiders();
    const [row] = await db.select().from(trips).where(eq(trips.id, trip.id));
    if (!row) throw new Error("trip missing");
    expect(await invitableSeats(db, row)).toBe(1);
  });

  it("reads as inside its ratio on the trip page and the crew request", async () => {
    const { db, shop, trip, staff, students } = await classWithRiders();
    // Back to a full class: at its ratio, not over it, riders or none.
    await db
      .update(bookings)
      .set({ status: "booked" })
      .where(eq(bookings.id, students[0] ?? ""));
    expect(await tripRatioGapNeedsInstructor(db, shop.id, trip.id)).toBe(false);
    const [shopRow] = await db.select().from(shops).where(eq(shops.id, shop.id));
    if (!shopRow) throw new Error("shop missing");
    const overview = await getTripOverview(db, shopRow, trip.id, staff.id);
    expect(overview?.crew.crewGap).toEqual({ code: "none" });
  });

  it("gives a released student's place back beside riders", async () => {
    const { db, shop, trip, staff, students } = await classWithRiders();
    const [, absent] = students;
    if (!absent) throw new Error("second student missing");
    // Re-fill the cancelled place, then release one student and seat a rider in the space.
    await db
      .update(bookings)
      .set({ status: "booked" })
      .where(eq(bookings.id, students[0] ?? ""));
    const after = new Date(trip.startsAt.getTime() + 60 * 60 * 1000);
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: absent,
        recordedByPersonId: staff.id,
        now: after,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await undoBookingNoShow(db, {
        shopId: shop.id,
        bookingId: absent,
        recordedByPersonId: staff.id,
        now: after,
      }),
    ).toMatchObject({ ok: true });
  });
});
