// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBooking } from "./bookings";
import { retryBookingConfirmation, sendCourseSeatConfirmation } from "./notifications";
import { courses, notificationDeliveries } from "./schema";
import { seatDiver } from "./seat-diver";
import { listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **A staff-seated course student gets the learning materials too** (ADR
 * 20261008-course-learning-materials). The public booking form was the only
 * sender of a confirmation; a student seated at the desk heard of the
 * eLearning a week out at best. Regression for the dive-domain review on #2260.
 */
const ctx = fileScopedShopContext();

async function setup() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const session = trips.find((trip) => trip.title === "Open Water Diver — three-day course");
  const funDive = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!session || !funDive) throw new Error("seeded departures missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("seeded staff missing");
  return { db, shop, session, funDive, staffId: staff.person.id };
}

async function book(tripId: string, tag: string) {
  const { db, shop } = ctx;
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId,
    participantType: "diver",
    fullName: `Course Student ${tag}`,
    email: `course-student-${tag}@example.com`,
  });
  if (!outcome.ok) throw new Error(`booking failed: ${outcome.reason}`);
  return outcome.bookingId;
}

describe("the booking confirmation for a course seat", () => {
  it("carries the course's materials, with links", async () => {
    const { db, shop, session } = await setup();
    const bookingId = await book(session.id, "direct");
    const email = fakeEmail();

    await sendCourseSeatConfirmation(db, shop.id, bookingId, email.provider);

    const [sent] = email.sent;
    expect(sent?.kind).toBe("booking_confirmation");
    expect(sent && "learningMaterials" in sent ? sent.learningMaterials : null).toEqual([
      expect.objectContaining({ url: "https://www.padi.com/" }),
    ]);
  });

  it("sends nothing for a fun dive, or a course with no materials", async () => {
    const { db, shop, session, funDive } = await setup();
    const email = fakeEmail();
    expect(
      await sendCourseSeatConfirmation(db, shop.id, await book(funDive.id, "fun"), email.provider),
    ).toBeNull();

    await db
      .update(courses)
      .set({ learningMaterials: [] })
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    expect(
      await sendCourseSeatConfirmation(db, shop.id, await book(session.id, "bare"), email.provider),
    ).toBeNull();
    expect(email.sent).toHaveLength(0);
    await db
      .update(courses)
      .set({ learningMaterials: [{ name: "Open Water eLearning", url: "https://www.padi.com/" }] })
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
  });

  it("puts the materials on a staff-triggered resend", async () => {
    const { db, shop, session } = await setup();
    const bookingId = await book(session.id, "resend");
    const email = fakeEmail();

    await retryBookingConfirmation(db, shop.id, bookingId, email.provider);

    const [sent] = email.sent;
    expect(sent && "learningMaterials" in sent ? sent.learningMaterials?.length : 0).toBe(1);
  });

  it("goes out when a staffer seats a student on the course session", async () => {
    const { db, shop, session, staffId } = await setup();
    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: session.id,
      actorPersonId: staffId,
      diver: { fullName: "Desk Student", email: "desk-student@example.com" },
      entry: "roster",
      refusals: "specific",
    });
    if (!result.ok) throw new Error(`seating failed: ${result.reason}`);

    const rows = await db
      .select({ kind: notificationDeliveries.kind })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, result.bookingId));
    expect(rows.map((row) => row.kind)).toContain("booking_confirmation");
  });
});
