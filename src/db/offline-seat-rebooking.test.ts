import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import { bookings } from "./schema";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

const ctx = fileScopedShopContext();

it("starts a new offline assignment when a cancelled seat is rebooked", async () => {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!trip) throw new Error("trip missing");
  const input = {
    actor: "public" as const,
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Mae Current",
    email: "mae-current@example.com",
  };
  const first = await createBooking(db, input);
  if (!first.ok) throw new Error("booking failed");
  expect(await cancelBooking(db, shop.id, first.bookingId)).toMatchObject({ ok: true });
  const again = await createBooking(db, input);
  expect(again).toMatchObject({ ok: true, bookingId: first.bookingId });
  const [seat] = await db.select().from(bookings).where(eq(bookings.id, first.bookingId));
  expect(seat?.offlineAssignmentGeneration).toBe(2);
});
