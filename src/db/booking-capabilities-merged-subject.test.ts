// @vitest-environment node
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { createBooking } from "./bookings";
import { bookings, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const fileContext = fileScopedShopContext();

it("refuses an existing link when its booking remains on a merged-away subject", async () => {
  const { db, shop } = fileContext;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("expected seeded trip");
  const created = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Merged Subject Diver",
    email: "merged-subject@example.com",
  });
  if (!created.ok) throw new Error("expected booking");
  const [booking] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, created.bookingId));
  if (!booking) throw new Error("expected booking subject");
  const [survivor] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Merged Subject Survivor" })
    .returning({ id: people.id });
  if (!survivor) throw new Error("expected survivor");
  const issued = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: created.bookingId,
    purpose: "readiness",
  });
  if (!issued) throw new Error("expected capability");
  const now = nowDate();
  await db
    .update(people)
    .set({
      mergedIntoPersonId: survivor.id,
      mergedAt: now,
      mergedByPersonId: survivor.id,
      deletedAt: now,
    })
    .where(eq(people.id, booking.personId));

  expect(
    await verifyBookingCapability(db, { token: issued.token, purpose: "readiness" }),
  ).toBeNull();
});
