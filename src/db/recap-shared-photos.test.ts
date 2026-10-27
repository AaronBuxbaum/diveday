import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import {
  addRecapPhoto,
  getRecapPageData,
  getRecapPageState,
  listRecapPhotosForTrips,
  unshareRecapPhoto,
} from "./recap";
import { bookings, people, rollCallEvents } from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";

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

  it("hides an ashore diver's photo until a later boarding, and still closes an ashore viewer's recap", async () => {
    const { db, shop, reef, bookingId: sharer } = await recapContext();
    const { bookingId: viewer } = await recapContext(SAM);
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("staff missing");
    const photo = await addRecapPhoto(db, {
      bookingId: sharer,
      imageUrl: "https://img/shared.jpg",
      shareWithBoat: true,
    });
    if (!photo.ok) throw new Error("photo not added");
    let minute = 0;
    const record = (bookingId: string, status: "boarded" | "not_boarded", checkpoint: string) =>
      db.insert(rollCallEvents).values({
        shopId: shop.id,
        tripId: reef.id,
        bookingId,
        recordedByPersonId: staff.person.id,
        status,
        checkpoint,
        occurredAt: new Date(reef.startsAt.getTime() + minute++ * 60_000),
      });
    await record(viewer, "boarded", "departure");
    await record(sharer, "not_boarded", "departure");
    const ashore = await getRecapPageState(db, viewer);
    expect(ashore.kind).toBe("recap");
    if (ashore.kind !== "recap") throw new Error("viewer recap closed");
    expect(ashore.data.photos.some((entry) => entry.id === photo.photo.id)).toBe(false);
    await record(sharer, "boarded", "after_dive_1");
    const joined = await getRecapPageState(db, viewer);
    expect(joined.kind).toBe("recap");
    if (joined.kind !== "recap") throw new Error("viewer recap closed");
    expect(joined.data.photos.some((entry) => entry.id === photo.photo.id)).toBe(true);
    await record(viewer, "not_boarded", "departure");
    expect((await getRecapPageState(db, viewer)).kind).toBe("dead");
  });

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

  /**
   * **Only a seat a recap would show can publish to the boat** (ADR
   * 20261016-shared-boat-photos §3; security review of layer r5-4, F2). A held
   * seat's holder may not be the person it matched, so their first name would
   * misattribute the photo; a removed diver's name stops publishing with them.
   */
  it("leaves every recap when the sharer's seat becomes held", async () => {
    const { db, bookingId } = await recapContext();
    const { bookingId: samBooking } = await recapContext(SAM);
    const shared = await addRecapPhoto(db, {
      bookingId,
      imageUrl: "https://img/shared.jpg",
      shareWithBoat: true,
    });
    if (!shared.ok) throw new Error("photo not added");
    expect((await getRecapPageData(db, samBooking))?.photos.some((p) => p.sharedBy)).toBe(true);

    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, bookingId));
    expect((await getRecapPageData(db, samBooking))?.photos.some((p) => p.sharedBy)).toBe(false);
  });

  it("leaves every recap when the sharer is removed", async () => {
    const { db, bookingId } = await recapContext();
    const { bookingId: samBooking } = await recapContext(SAM);
    const shared = await addRecapPhoto(db, {
      bookingId,
      imageUrl: "https://img/shared.jpg",
      shareWithBoat: true,
    });
    if (!shared.ok) throw new Error("photo not added");
    const [seat] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!seat) throw new Error("seat missing");

    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, seat.personId));
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

/**
 * **The sharer can take a photo back** (issue #2806; ADR
 * 20261016-shared-boat-photos, Consequences). Clearing the column is the act,
 * and only the booking that owns the photo may clear it.
 */
describe("a diver stops sharing a photo with the boat", () => {
  const SAM = { fullName: "Sam Shutter", email: "recap-sam@example.com" };

  it("takes it off the other recaps and keeps it on the sharer's own", async () => {
    const { db, bookingId } = await recapContext();
    const { bookingId: samBooking } = await recapContext(SAM);
    const shared = await addRecapPhoto(db, {
      bookingId,
      imageUrl: "https://img/shared.jpg",
      shareWithBoat: true,
    });
    if (!shared.ok) throw new Error("photo not added");
    expect((await getRecapPageData(db, samBooking))?.photos.some((p) => p.sharedBy)).toBe(true);

    expect(await unshareRecapPhoto(db, { bookingId, photoId: shared.photo.id })).toEqual({
      ok: true,
    });

    expect((await getRecapPageData(db, samBooking))?.photos.some((p) => p.sharedBy)).toBe(false);
    const raes = await getRecapPageData(db, bookingId);
    expect(raes?.photos.find((photo) => photo.id === shared.photo.id)).toEqual({
      id: shared.photo.id,
      imageUrl: "https://img/shared.jpg",
      caption: null,
    });
  });

  it("refuses another booking on the same boat, and the photo stays shared", async () => {
    const { db, bookingId } = await recapContext();
    const { bookingId: samBooking } = await recapContext(SAM);
    const shared = await addRecapPhoto(db, {
      bookingId,
      imageUrl: "https://img/shared.jpg",
      shareWithBoat: true,
    });
    if (!shared.ok) throw new Error("photo not added");

    expect(
      await unshareRecapPhoto(db, { bookingId: samBooking, photoId: shared.photo.id }),
    ).toEqual({ ok: false });

    expect((await getRecapPageData(db, samBooking))?.photos.some((p) => p.sharedBy)).toBe(true);
  });

  it("does nothing to a photo that was never shared", async () => {
    const { db, bookingId } = await recapContext();
    const kept = await addRecapPhoto(db, { bookingId, imageUrl: "https://img/mine.jpg" });
    if (!kept.ok) throw new Error("photo not added");
    expect(await unshareRecapPhoto(db, { bookingId, photoId: kept.photo.id })).toEqual({
      ok: false,
    });
  });
});
