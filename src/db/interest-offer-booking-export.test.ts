import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { loadDiverExportBundleInput, loadShopExportBundleInput } from "./export";
import { bookings, dateRequestOfferBookings, interests } from "./schema";

const ctx = fileScopedShopContext();

it("exports offer-to-booking links only in the shop bundle", async () => {
  const { db, shop } = ctx;
  const [booking] = await db
    .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.shopId, shop.id))
    .limit(1);
  if (!booking) throw new Error("setup: seeded booking missing");
  const [request] = await db
    .insert(interests)
    .values({
      shopId: shop.id,
      scope: "date",
      askedBy: "diver",
      interest: "reef dive",
      name: "Anonymous request",
      email: "anonymous-export@example.com",
    })
    .returning({ id: interests.id });
  if (!request) throw new Error("setup: request missing");
  const [offer] = await db
    .insert(interests)
    .values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId: booking.tripId,
      parentInterestId: request.id,
      partySize: 2,
      offeredAt: nowDate(),
    })
    .returning({ id: interests.id });
  if (!offer) throw new Error("setup: offer missing");
  await db.insert(dateRequestOfferBookings).values({
    shopId: shop.id,
    interestId: offer.id,
    bookingId: booking.id,
  });

  const shopBundle = await loadShopExportBundleInput(db, shop.id);
  if (!shopBundle) throw new Error("setup: shop export missing");
  const links = shopBundle.tables.find((table) => table.file === "date_request_offer_bookings.csv");
  expect(links?.rows).toEqual([[offer.id, booking.id]]);

  const diverBundle = await loadDiverExportBundleInput(db, shop.id, booking.personId);
  if (!diverBundle) throw new Error("setup: diver export missing");
  expect(diverBundle.tables.some((table) => table.file === "date_request_offer_bookings.csv")).toBe(
    false,
  );
});
