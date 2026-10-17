// @vitest-environment node
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { tellCourseCertified } from "./course-certified";
import { courses, people, trips as tripRows } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

/**
 * **Becoming certified is told to the student** (third UX review, item 14):
 * one message by the diver's usual channel, with the shop's next course on
 * from the new level, and nothing for a diver the shop cannot reach.
 */
const ctx = fileScopedShopContext();

async function courseSeat() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const session = trips.find((trip) => trip.title.startsWith("Advanced Open Water Diver"));
  if (!session) throw new Error("the seeded shop is missing a course session");
  const [student] = await getTripRoster(db, shop.id, session.id);
  if (!student) throw new Error("the seeded course session has an empty roster");
  return { db, shop, tripId: session.id, personId: student.person.id };
}

const input = (seat: Awaited<ReturnType<typeof courseSeat>>) => ({
  shopId: seat.shop.id,
  personId: seat.personId,
  tripId: seat.tripId,
  certificationId: randomUUID(),
  level: "advanced_open_water" as const,
  recordedAt: new Date("2026-10-25T15:00:00Z"),
});

describe("tellCourseCertified", () => {
  it("emails the student their level, with the next course on from it", async () => {
    const seat = await courseSeat();
    const { db, shop } = seat;
    await db
      .update(people)
      .set({ email: "student@example.com" })
      .where(eq(people.id, seat.personId));
    const [next] = await db
      .select({ slug: courses.slug })
      .from(courses)
      .where(
        and(
          eq(courses.shopId, shop.id),
          eq(courses.isActive, true),
          eq(courses.isIntroCourse, false),
          eq(courses.minimumCertificationLevel, "advanced_open_water"),
        ),
      )
      .limit(1);
    const email = fakeEmail();
    expect(
      await tellCourseCertified(db, input(seat), {
        emailProvider: email.provider,
        appOrigin: "https://diveday.test",
      }),
    ).toBe("sent");
    expect(email.sent).toHaveLength(1);
    const [sent] = email.sent;
    expect(sent).toMatchObject({
      kind: "course_certified",
      to: "student@example.com",
      level: "advanced_open_water",
    });
    if (sent?.kind !== "course_certified") throw new Error("wrong kind");
    // The course's agency travels with it, so the message can say who issues
    // the card (fourth review, item 40).
    expect(sent.agency).toBeTruthy();
    // And its title: the card is the course the shop ran, not DiveDay's rung.
    const [issuing] = await db
      .select({ title: courses.title })
      .from(courses)
      .innerJoin(tripRows, eq(tripRows.courseId, courses.id))
      .where(eq(tripRows.id, seat.tripId));
    expect(sent.courseTitle).toBe(issuing?.title);
    expect(sent.junior).toBeUndefined();
    if (next) {
      expect(sent.nextCourse?.url).toBe(`https://diveday.test/s/${shop.slug}/courses/${next.slug}`);
    } else {
      expect(sent.nextCourse).toBeUndefined();
    }
  });

  it("tells a diver under 15 on the recorded date that the card is Junior", async () => {
    const seat = await courseSeat();
    await seat.db
      .update(people)
      .set({ email: "junior@example.com", dateOfBirth: "2012-06-01" })
      .where(eq(people.id, seat.personId));
    const email = fakeEmail();
    await tellCourseCertified(seat.db, input(seat), { emailProvider: email.provider });
    const [sent] = email.sent;
    if (sent?.kind !== "course_certified") throw new Error("wrong kind");
    expect(sent.junior).toBe(true);
  });

  it("texts a student with a phone and no email", async () => {
    const seat = await courseSeat();
    await seat.db
      .update(people)
      .set({ email: null, phone: "+13055550142" })
      .where(eq(people.id, seat.personId));
    const sms = fakeSms();
    expect(
      await tellCourseCertified(seat.db, input(seat), {
        smsProvider: sms.provider,
        whatsAppProviders: new Map(),
      }),
    ).toBe("sent");
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.body).toContain(seat.shop.name);
  });

  it("sends nothing to a student the shop cannot reach", async () => {
    const seat = await courseSeat();
    await seat.db
      .update(people)
      .set({ email: null, phone: null })
      .where(eq(people.id, seat.personId));
    const email = fakeEmail();
    expect(await tellCourseCertified(seat.db, input(seat), { emailProvider: email.provider })).toBe(
      "no_contact",
    );
    expect(email.sent).toHaveLength(0);
  });

  it("never reaches another shop's departure", async () => {
    const seat = await courseSeat();
    const email = fakeEmail();
    expect(
      await tellCourseCertified(
        seat.db,
        { ...input(seat), shopId: randomUUID() },
        { emailProvider: email.provider },
      ),
    ).toBe("skipped");
    expect(email.sent).toHaveLength(0);
  });
});
