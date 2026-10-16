import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { addRecapPhoto, getRecapPageData, listRecapPhotosForTrips } from "./recap";
import { bookings } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

const RAE = { fullName: "Rae Recap", email: "recap-rae@example.com" };

/** Books a diver onto the demo reef day, as `recap.test.ts` does. */
async function recapContext(diver: { fullName: string; email: string } = RAE) {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    { actor: "staff", shopId: shop.id, tripId: reef.id, ...diver },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  return { db, shop, reef, bookingId: party.bookings[0].bookingId };
}

describe("a photo shared with the boat (H-129)", () => {
  const SAM = { fullName: "Sam Shutter", email: "recap-sam@example.com" };

  it("shows on the rest of the boat's recaps under the sharer's first name, and only when ticked", async () => {
    const { db, bookingId } = await recapContext();
    const { bookingId: samBooking } = await recapContext(SAM);
    const shared = await addRecapPhoto(db, {
      bookingId,
      imageUrl: "https://img/shared.jpg",
      caption: "Turtle",
      shareWithBoat: true,
    });
    const kept = await addRecapPhoto(db, { bookingId, imageUrl: "https://img/mine.jpg" });
    if (!shared.ok || !kept.ok) throw new Error("photos not added");

    const sams = await getRecapPageData(db, samBooking);
    const fromRae = sams?.photos.filter((photo) => photo.sharedBy) ?? [];
    expect(fromRae).toEqual([
      {
        id: shared.photo.id,
        imageUrl: "https://img/shared.jpg",
        caption: "Turtle",
        sharedBy: "Rae",
      },
    ]);
    expect(sams?.photos.some((photo) => photo.imageUrl === "https://img/mine.jpg")).toBe(false);

    // On the sharer's own page it is theirs, marked as shared, never "from" anyone.
    const raes = await getRecapPageData(db, bookingId);
    expect(raes?.photos.find((photo) => photo.id === shared.photo.id)).toEqual({
      id: shared.photo.id,
      imageUrl: "https://img/shared.jpg",
      caption: "Turtle",
      sharedWithBoat: true,
    });
    expect(
      raes?.photos.find((photo) => photo.id === kept.photo.id)?.sharedWithBoat,
    ).toBeUndefined();
  });

  it("leaves every recap when the sharer's seat is taken off the boat", async () => {
    const { db, bookingId } = await recapContext();
    const { bookingId: samBooking } = await recapContext(SAM);
    const shared = await addRecapPhoto(db, {
      bookingId,
      imageUrl: "https://img/shared.jpg",
      shareWithBoat: true,
    });
    if (!shared.ok) throw new Error("photo not added");
    expect((await getRecapPageData(db, samBooking))?.photos.some((p) => p.sharedBy)).toBe(true);

    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
    expect((await getRecapPageData(db, samBooking))?.photos.some((p) => p.sharedBy)).toBe(false);
  });

  it("tells staff which photos reach the whole boat", async () => {
    const { db, shop, reef, bookingId } = await recapContext();
    const shared = await addRecapPhoto(db, {
      bookingId,
      imageUrl: "https://img/shared.jpg",
      shareWithBoat: true,
    });
    const kept = await addRecapPhoto(db, { bookingId, imageUrl: "https://img/mine.jpg" });
    if (!shared.ok || !kept.ok) throw new Error("photos not added");
    const gallery = await listRecapPhotosForTrips(db, shop.id, [reef.id]);
    expect(gallery.find((photo) => photo.id === shared.photo.id)?.sharedWithBoat).toBe(true);
    expect(gallery.find((photo) => photo.id === kept.photo.id)?.sharedWithBoat).toBe(false);
  });
});
