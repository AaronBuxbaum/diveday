// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBooking, rescheduleBooking } from "./bookings";
import type { AppDb } from "./client";
import { createTestDb } from "./client";
import {
  archiveCourse,
  createCourse,
  getCourseBySlug,
  listActiveCourses,
  listActiveCoursesForSitemap,
  listCourses,
  pagedCourses,
  setCourseVisibility,
  updateCourse,
  updateCourseContent,
} from "./courses";
import { courses, people, shops, tripAssignments, tripRequirements } from "./schema";
import { listShopsForSitemap } from "./shops";
import {
  createTrip,
  getTripWithBooked,
  listStaff,
  listUpcomingSessionsForCourse,
  setTripCrew,
  upcomingTripsWithCounts,
} from "./trips";

/**
 * The seeded demo has a real instructor calendar. Keep synthetic course
 * sessions outside it so these tests exercise course admission rules, not the
 * intentionally shared-crew overlap guard.
 *
 * 180 days, not 45. The seed schedules departures out to day 75, and these
 * sessions start at *the current time of day* 45 days out — so as the wall
 * clock advanced, that four-hour window swept across the seeded calendar and
 * the instructor assignment started failing on an overlap, at some hours of the
 * day and not others. Anything past day 75 and short of the one year-out row
 * is clear no matter what time the suite runs.
 */
const OPEN_TEST_SESSION_OFFSET_MS = 180 * 24 * 60 * 60 * 1000;

async function courseContext() {
  const { db, shop } = await seededShopContext();
  const sessions = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const discover = sessions.find((session) => session.course?.title === "Discover Scuba Diving");
  if (!discover) throw new Error("discover session missing");
  return { db, shop, discover };
}

describe("course catalog and sessions (in-memory PGlite)", () => {
  it("admits an uncertified participant to an instructor-staffed Discover Scuba session", async () => {
    const { db, shop, discover } = await courseContext();
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: discover.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    expect(outcome).toMatchObject({ ok: true, personName: "Nora Quinn" });
  });

  it("fails closed when an instructor-led session loses its instructor", async () => {
    const { db, shop, discover } = await courseContext();
    await db.delete(tripAssignments).where(eq(tripAssignments.tripId, discover.id));
    await expect(
      createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: discover.id,
        fullName: "Nora Quinn",
        email: "nora@example.com",
      }),
    ).resolves.toEqual({ ok: false, reason: "course_unstaffed" });
  });

  // PADI's published entry-level in-water ratio (H-08, src/lib/course-ratios.ts):
  // 8 students per solo instructor, no certified assistant.
  it("caps an entry-level session's bookings at the instructor ratio, independent of trip capacity", async () => {
    const { db, shop } = await courseContext();
    const [discoverCourse] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Discover Scuba Diving")));
    if (!discoverCourse) throw new Error("Discover Scuba Diving course missing");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");

    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: discoverCourse.id,
      title: "Ratio test session",
      startsAt: new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS),
      endsAt: new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS + 4 * 60 * 60 * 1000),
      capacity: 20, // well above the 8-seat ratio cap, so capacity never binds first
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create ratio test trip");
    const staffed = await setTripCrew(db, shop.id, trip.id, [instructor.person.id]);
    if (!staffed) throw new Error("failed to assign instructor");

    for (let i = 0; i < 8; i++) {
      const outcome = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: `Ratio Diver ${i}`,
        email: `ratio-diver-${i}@example.com`,
      });
      expect(outcome).toMatchObject({ ok: true });
    }

    // The 9th booking exceeds the solo instructor's 8-seat ratio, even though
    // the trip's own capacity (20) still has room.
    await expect(
      createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Ratio Diver 9",
        email: "ratio-diver-9@example.com",
      }),
    ).resolves.toEqual({ ok: false, reason: "course_ratio_full" });
  });

  it("does not ratio-gate a continuing-education course (a verified card already gates it)", async () => {
    const { db, shop } = await courseContext();
    const [aowCourse] = await db
      .insert(courses)
      .values({
        shopId: shop.id,
        title: "Advanced Open Water — ratio test",
        slug: "advanced-open-water-ratio-test",
        // Set by the certifying agency (schema.ts) — this is what gates the
        // booking, not trip_requirements, which merely inherits it at trip
        // creation (insertTripInstance).
        minimumCertificationLevel: "open_water",
      })
      .returning();
    if (!aowCourse) throw new Error("failed to create AOW test course");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");

    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: aowCourse.id,
      title: "AOW ratio test session",
      startsAt: new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS),
      endsAt: new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS + 4 * 60 * 60 * 1000),
      capacity: 20,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create AOW ratio test trip");
    const staffed = await setTripCrew(db, shop.id, trip.id, [instructor.person.id]);
    if (!staffed) throw new Error("failed to assign instructor");

    // No card on file, so every attempt fails on the prerequisite gate, never
    // the ratio gate — confirming the ratio cap is scoped to entry-level only.
    for (let i = 0; i < 9; i++) {
      const outcome = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: `AOW Ratio Diver ${i}`,
        email: `aow-ratio-diver-${i}@example.com`,
      });
      expect(outcome).toEqual({ ok: false, reason: "course_prerequisite" });
    }
  });

  // H-08 option B: a course's minimum age is enforced only for a diver who
  // actually has a date of birth on file, and is measured on the day the
  // course runs rather than the day it's booked.
  describe("course minimum age", () => {
    async function ageContext(minimumAge: number, startsAt: Date) {
      const { db, shop } = await courseContext();
      const [course] = await db
        .insert(courses)
        .values({
          shopId: shop.id,
          title: `Age-gated course ${startsAt.getTime()}`,
          slug: `age-gated-course-${startsAt.getTime()}`,
          minimumAge,
        })
        .returning();
      if (!course) throw new Error("failed to create age-gated course");
      const staff = await listStaff(db, shop.id);
      const instructor = staff.find((entry) => entry.roles.includes("instructor"));
      if (!instructor) throw new Error("seeded instructor missing");
      const trip = await createTrip(db, {
        shopId: shop.id,
        courseId: course.id,
        title: "Age gate session",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
        capacity: 8,
        plannedDives: 2,
      });
      if (!trip) throw new Error("failed to create age-gate trip");
      await setTripCrew(db, shop.id, trip.id, [instructor.person.id]);
      return { db, shop, trip };
    }

    /** A diver already on file, so the booking reuses the row carrying the DOB. */
    async function diverWithDob(db: AppDb, shopId: string, dob: string | null, email: string) {
      const [person] = await db
        .insert(people)
        .values({ shopId, fullName: `Age Diver ${email}`, email, dateOfBirth: dob })
        .returning();
      if (!person) throw new Error("failed to insert age-test diver");
      return person;
    }

    it("fails open for a diver with no date of birth on file", async () => {
      const startsAt = new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS);
      const { db, shop, trip } = await ageContext(15, startsAt);
      const person = await diverWithDob(db, shop.id, null, "no-dob@example.com");
      await expect(
        createBooking(db, {
          actor: "staff",
          shopId: shop.id,
          tripId: trip.id,
          personId: person.id,
        }),
      ).resolves.toMatchObject({ ok: true });
    });

    it("fails open for a brand-new walk-in, who has no date on file yet", async () => {
      const startsAt = new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS);
      const { db, shop, trip } = await ageContext(15, startsAt);
      await expect(
        createBooking(db, {
          actor: "staff",
          shopId: shop.id,
          tripId: trip.id,
          fullName: "Walk In",
          email: "walk-in-age@example.com",
        }),
      ).resolves.toMatchObject({ ok: true });
    });

    it("refuses a diver under the minimum age on the course date", async () => {
      const startsAt = new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS);
      const { db, shop, trip } = await ageContext(15, startsAt);
      const tenYearsAgo = new Date(Date.now() - 10 * 365.25 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const person = await diverWithDob(db, shop.id, tenYearsAgo, "too-young@example.com");
      await expect(
        createBooking(db, {
          actor: "staff",
          shopId: shop.id,
          tripId: trip.id,
          personId: person.id,
        }),
      ).resolves.toEqual({ ok: false, reason: "course_min_age" });
    });

    it("admits a diver who is old enough", async () => {
      const startsAt = new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS);
      const { db, shop, trip } = await ageContext(15, startsAt);
      const thirtyYearsAgo = new Date(Date.now() - 30 * 365.25 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const person = await diverWithDob(db, shop.id, thirtyYearsAgo, "old-enough@example.com");
      await expect(
        createBooking(db, {
          actor: "staff",
          shopId: shop.id,
          tripId: trip.id,
          personId: person.id,
        }),
      ).resolves.toMatchObject({ ok: true });
    });

    it("does not refuse an anonymous public booking on someone else's date of birth", async () => {
      // Refusing here would answer "is the holder of this address under N?" to
      // anyone who can guess an address — a disclosure about a minor, to an
      // unauthenticated caller, and unsound besides: the public form never
      // proves the submitter is the person on file for that email (H-13).
      const startsAt = new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS);
      const { db, shop, trip } = await ageContext(15, startsAt);
      const tenYearsAgo = new Date(Date.now() - 10 * 365.25 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const person = await diverWithDob(db, shop.id, tenYearsAgo, "public-probe@example.com");

      // Staff path still refuses...
      await expect(
        createBooking(db, {
          actor: "staff",
          shopId: shop.id,
          tripId: trip.id,
          personId: person.id,
        }),
      ).resolves.toEqual({ ok: false, reason: "course_min_age" });
      // ...the public path books, and the under-age seat is caught by the
      // readiness blocker instead of by a refusal that leaks.
      await expect(
        createBooking(db, {
          shopId: shop.id,
          tripId: trip.id,
          actor: "public",
          fullName: "Age Diver public-probe@example.com",
          email: "public-probe@example.com",
        }),
      ).resolves.toMatchObject({ ok: true });
    });

    it("refuses a diver self-service reschedule onto an age-gated course they're too young for (Codex finding, docs ADR 20260727-diver-self-service-cancel)", async () => {
      // Reschedule's destination booking is created with the token-verified
      // diver's own personId, not a free-typed guess — so unlike an
      // anonymous public booking, the real age gate should apply, not the
      // fail-open readiness-blocker-only path.
      const startsAt = new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS);
      const { db, shop, trip } = await ageContext(15, startsAt);
      const tenYearsAgo = new Date(Date.now() - 10 * 365.25 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const person = await diverWithDob(
        db,
        shop.id,
        tenYearsAgo,
        "reschedule-too-young@example.com",
      );

      const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
      const openTrip = upcoming.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
      if (!openTrip) throw new Error("expected seeded open trip missing");
      const original = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: openTrip.id,
        personId: person.id,
      });
      if (!original.ok) throw new Error("setup booking failed");

      await expect(
        rescheduleBooking(db, {
          shopId: shop.id,
          bookingId: original.bookingId,
          newTripId: trip.id,
        }),
      ).resolves.toEqual({ ok: false, reason: "course_min_age" });
      // The refused reschedule never touched the original seat.
      const openRoster = await getTripWithBooked(db, shop.id, openTrip.id);
      expect(openRoster?.booked).toBe(1);
    });

    it("measures age on the course date, so a birthday before it admits the diver", async () => {
      // Turns 15 in ~40 days; the session runs ~100 days out, after that.
      const startsAt = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
      const { db, shop, trip } = await ageContext(15, startsAt);
      const turns15Soon = new Date(Date.now() - (15 * 365.25 - 40) * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const person = await diverWithDob(db, shop.id, turns15Soon, "birthday-first@example.com");
      await expect(
        createBooking(db, {
          actor: "staff",
          shopId: shop.id,
          tripId: trip.id,
          personId: person.id,
        }),
      ).resolves.toMatchObject({ ok: true });
    });
  });

  // The sourced ratio (src/lib/course-ratios.ts) is a PADI figure; DiveDay does
  // not have an independently-sourced SSI (or other agency) number, so the
  // gate must not apply PADI's ratio to a course whose own agency isn't PADI.
  it("does not ratio-gate an ungated course from a non-PADI agency", async () => {
    const { db, shop } = await courseContext();
    const [ssiCourse] = await db
      .insert(courses)
      .values({
        shopId: shop.id,
        title: "SSI Open Water — ratio test",
        slug: "ssi-open-water-ratio-test",
        agency: "ssi",
        // Ungated, same as PADI's Open Water/DSD — but no PADI ratio applies.
        minimumCertificationLevel: null,
      })
      .returning();
    if (!ssiCourse) throw new Error("failed to create SSI test course");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");

    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: ssiCourse.id,
      title: "SSI ratio test session",
      startsAt: new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS),
      endsAt: new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS + 4 * 60 * 60 * 1000),
      capacity: 10, // above the PADI ratio (8) that must NOT apply here
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create SSI ratio test trip");
    const staffed = await setTripCrew(db, shop.id, trip.id, [instructor.person.id]);
    if (!staffed) throw new Error("failed to assign instructor");

    // All 10 succeed — a solo instructor would be ratio-capped at 8 under the
    // PADI figure, but this course isn't PADI's, so only capacity (10) binds.
    for (let i = 0; i < 10; i++) {
      const outcome = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: `SSI Ratio Diver ${i}`,
        email: `ssi-ratio-diver-${i}@example.com`,
      });
      expect(outcome).toMatchObject({ ok: true });
    }
    await expect(
      createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "SSI Ratio Diver 10",
        email: "ssi-ratio-diver-10@example.com",
      }),
    ).resolves.toEqual({ ok: false, reason: "trip_full" });
  });

  it("inherits an Advanced course baseline and requires a verified Open Water card at enrollment", async () => {
    const { db, shop } = await courseContext();
    const course = await createCourse(db, {
      shopId: shop.id,
      title: "Advanced Open Water — Weekend",
      minimumCertificationLevel: "open_water",
    });
    if (!course) throw new Error("course not created");
    const session = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Advanced Open Water — July weekend",
      startsAt: new Date("2030-07-20T13:00:00.000Z"),
      endsAt: new Date("2030-07-20T17:00:00.000Z"),
      capacity: 4,
    });
    if (!session) throw new Error("session not created");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("instructor missing");
    await db.insert(tripAssignments).values({ tripId: session.id, personId: instructor.person.id });

    const stored = await getTripWithBooked(db, shop.id, session.id);
    expect(stored?.course?.id).toBe(course.id);

    await expect(
      createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: session.id,
        fullName: "Nora Quinn",
        email: "nora@example.com",
      }),
    ).resolves.toEqual({ ok: false, reason: "course_prerequisite" });

    await expect(
      createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: session.id,
        fullName: "Priya Sharma",
        email: "priya.sharma@example.com",
      }),
    ).resolves.toMatchObject({ ok: true, personName: "Priya Sharma" });

    const active = await listActiveCourses(db, shop.id);
    expect(active.map((entry) => entry.title)).toContain("Advanced Open Water — Weekend");

    // A shop sets only its two prices; the agency owns the rest, so an update
    // never rewrites the title or the prerequisite card.
    const updated = await updateCourse(db, shop.id, course.id, {
      priceCents: 49900,
      eLearningPriceCents: 21000,
    });
    expect(updated).toMatchObject({
      title: "Advanced Open Water — Weekend",
      minimumCertificationLevel: "open_water",
      priceCents: 49900,
      eLearningPriceCents: 21000,
    });
    expect(await archiveCourse(db, shop.id, course.id)).toBe(true);
    expect((await listActiveCourses(db, shop.id)).some((entry) => entry.id === course.id)).toBe(
      false,
    );
    expect((await setCourseVisibility(db, shop.id, course.id, true))?.isActive).toBe(true);
  });

  it("schedules an entry-level course session with no cert gate, and an ordinary trip with one", async () => {
    const { db, shop } = await seededShopContext();
    // Open to uncertified divers — that is the point of the course, and the
    // session must not inherit the shop's default Open Water gate.
    const discover = await createCourse(db, {
      shopId: shop.id,
      title: "Try Scuba — evening",
      minimumCertificationLevel: null,
    });
    if (!discover) throw new Error("course not created");
    const session = await createTrip(db, {
      shopId: shop.id,
      courseId: discover.id,
      title: "Try Scuba — Thursday evening",
      startsAt: new Date("2030-08-01T22:00:00.000Z"),
      endsAt: new Date("2030-08-02T01:00:00.000Z"),
      capacity: 4,
    });
    if (!session) throw new Error("session not created");
    const [gate] = await db
      .select()
      .from(tripRequirements)
      .where(eq(tripRequirements.tripId, session.id));
    expect(gate?.minimumCertificationLevel).toBeNull();
    expect(gate?.requiresWaiver).toBe(true);

    const charter = await createTrip(db, {
      shopId: shop.id,
      title: "Two-tank reef charter",
      startsAt: new Date("2030-08-03T13:00:00.000Z"),
      endsAt: new Date("2030-08-03T17:00:00.000Z"),
      capacity: 8,
    });
    if (!charter) throw new Error("charter not created");
    const [charterGate] = await db
      .select()
      .from(tripRequirements)
      .where(eq(tripRequirements.tripId, charter.id));
    expect(charterGate?.minimumCertificationLevel).toBe("open_water");
  });
});

const emptyContent = {
  summary: null,
  overview: null,
  heroImageUrl: null,
  heroImageAlt: null,
  imageUrls: [],
  imageAlts: [],
  durationText: null,
  groupSizeText: null,
  prerequisiteNote: null,
  includes: [],
  excludes: [],
  scheduleDays: [],
  faqs: [],
  isIntroCourse: false,
};

describe("pagedCourses pagination (in-memory PGlite)", () => {
  it("pages with a keyset cursor and never repeats or skips a course", async () => {
    const { db, shop } = await seededShopContext();

    const all = await listCourses(db, shop.id);
    expect(all.length).toBeGreaterThan(0);

    const seen: string[] = [];
    let cursor: string | undefined;
    const maxHops = all.length + 1;
    for (let hops = 0; hops < maxHops; hops++) {
      const page = await pagedCourses(db, shop.id, { cursor, limit: 3 });
      expect(page.courses.length).toBeLessThanOrEqual(3);
      seen.push(...page.courses.map((course) => course.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all.map((course) => course.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("treats a mangled cursor as the first page", async () => {
    const { db, shop } = await seededShopContext();
    const all = await pagedCourses(db, shop.id);
    const mangled = await pagedCourses(db, shop.id, { cursor: "not-a-real-cursor" });
    expect(mangled.courses.map((course) => course.id)).toEqual(
      all.courses.map((course) => course.id),
    );
  });
});

describe("course content and public pages (in-memory PGlite)", () => {
  it("saves the marketing page without touching pricing, the cert gate, or the agency age", async () => {
    const { db, shop } = await seededShopContext();
    const course = await createCourse(db, {
      shopId: shop.id,
      title: "Cavern Diver",
      priceCents: 32500,
      // The minimum age is the agency's, set at creation and never edited on the
      // page — a content save must leave it exactly where it was.
      minimumAge: 15,
      minimumCertificationLevel: "open_water",
    });
    if (!course) throw new Error("course not created");

    const saved = await updateCourseContent(db, shop.id, course.id, {
      ...emptyContent,
      summary: "Plan and make dives to 40 metres",
      overview: "Four training dives over two days.",
      durationText: "2 days",
      includes: ["Four dives", "Tanks and weights"],
      scheduleDays: [
        { title: "Day 1", startTime: "08:00", endTime: "14:00", items: ["Dives 1–2"] },
      ],
      faqs: [{ question: "Do I need a computer?", answer: "We rent one." }],
    });
    expect(saved).toMatchObject({
      summary: "Plan and make dives to 40 metres",
      minimumAge: 15,
      priceCents: 32500,
      minimumCertificationLevel: "open_water",
    });
    expect(saved?.faqs).toEqual([{ question: "Do I need a computer?", answer: "We rent one." }]);
  });

  it("hides a course from scheduling without deleting it — staff can still find and reshow it", async () => {
    const { db, shop } = await seededShopContext();
    const course = await createCourse(db, { shopId: shop.id, title: "Sidemount Diver" });
    if (!course) throw new Error("course not created");

    const isActive = async () =>
      (await listActiveCourses(db, shop.id)).some((entry) => entry.id === course.id);

    expect(await isActive()).toBe(true);
    await setCourseVisibility(db, shop.id, course.id, false);
    expect(await isActive()).toBe(false);
    expect((await getCourseBySlug(db, shop.id, course.slug))?.id).toBe(course.id);

    expect((await setCourseVisibility(db, shop.id, course.id, true))?.isActive).toBe(true);
    expect(await isActive()).toBe(true);
  });

  it("finds a course by its public slug, scoped to the shop", async () => {
    const { db, shop } = await seededShopContext();
    // A title the seeded catalog does not already carry, so this exercises
    // slug minting rather than colliding with the shop's own course list.
    const course = await createCourse(db, { shopId: shop.id, title: "Cavern Diver" });
    expect((await getCourseBySlug(db, shop.id, "cavern-diver"))?.id).toBe(course?.id);
    expect(await getCourseBySlug(db, crypto.randomUUID(), "cavern-diver")).toBeNull();
  });

  it("lists a course's bookable sessions and leaves past ones behind", async () => {
    const { db, shop, discover } = await courseContext();
    const courseId = discover.courseId;
    if (!courseId) throw new Error("discover session has no course");

    const sessions = await listUpcomingSessionsForCourse(db, shop.id, courseId);
    expect(sessions.map((session) => session.id)).toContain(discover.id);
    expect(sessions[0]).toHaveProperty("booked");

    const distantFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    expect(await listUpcomingSessionsForCourse(db, shop.id, courseId, distantFuture)).toEqual([]);
  });
});

describe("sitemap queries (in-memory PGlite)", () => {
  it("includes a live shop's schedule and active course, and excludes hidden courses and demo shops", async () => {
    const db = await createTestDb();
    const [liveShop] = await db
      .insert(shops)
      .values({ name: "Live Shop", slug: "live-shop-sitemap", timezone: "America/New_York" })
      .returning();
    if (!liveShop) throw new Error("setup live shop insert failed");
    const [demoShop] = await db
      .insert(shops)
      .values({
        name: "Demo Shop",
        slug: "demo-shop-sitemap",
        timezone: "America/New_York",
        isDemo: true,
      })
      .returning();
    if (!demoShop) throw new Error("setup demo shop insert failed");

    await createCourse(db, {
      shopId: liveShop.id,
      title: "Visible Course",
      slug: "visible-course",
    });
    const hidden = await createCourse(db, {
      shopId: liveShop.id,
      title: "Hidden Course",
      slug: "hidden-course",
    });
    if (!hidden) throw new Error("setup hidden course insert failed");
    await setCourseVisibility(db, liveShop.id, hidden.id, false);
    await createCourse(db, {
      shopId: demoShop.id,
      title: "Demo Course",
      slug: "demo-course",
    });

    const shopRows = await listShopsForSitemap(db);
    expect(shopRows).toContainEqual({ slug: "live-shop-sitemap" });
    expect(shopRows.map((row) => row.slug)).not.toContain("demo-shop-sitemap");

    const courseRows = await listActiveCoursesForSitemap(db);
    expect(courseRows).toContainEqual({
      shopSlug: "live-shop-sitemap",
      courseSlug: "visible-course",
    });
    expect(courseRows).not.toContainEqual(expect.objectContaining({ courseSlug: "hidden-course" }));
    expect(courseRows).not.toContainEqual(
      expect.objectContaining({ shopSlug: "demo-shop-sitemap" }),
    );
  });
});
