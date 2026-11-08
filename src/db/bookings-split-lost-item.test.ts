// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { recordLostItem, tellLostItemOwner } from "../features/lost-items/store";
import { createBooking, splitBookingIdentity } from "./bookings";
import { lostItems } from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

describe("splitBookingIdentity and a found item on the held seat", () => {
  it("moves a found item recorded on the held seat onto the new diver", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
    const night = trips.find((t) => t.title.startsWith("Night Dive"));
    if (!open || !night) throw new Error("expected seeded trips missing");
    const first = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      phone: "+1-305-555-0199",
    });
    if (!first.ok) throw new Error("setup booking failed");
    const shared = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: night.id,
      personId: first.personId,
      fromNameMatch: { typedName: "Ben Quinn" },
    });
    if (!shared.ok) throw new Error("held-seat booking failed");
    const [staffer] = await listStaff(db, shop.id);
    if (!staffer) throw new Error("expected seeded staff");

    const recorded = await recordLostItem(db, {
      shopId: shop.id,
      tripId: night.id,
      bookingId: shared.bookingId,
      description: "Blue mask in a red case",
      actorPersonId: staffer.person.id,
    });
    if (!recorded.ok) throw new Error(`lost item refused: ${recorded.reason}`);
    expect(recorded.item.personId).toBe(first.personId);

    const result = await splitBookingIdentity(db, {
      shopId: shop.id,
      bookingId: shared.bookingId,
      actorPersonId: staffer.person.id,
      fullName: "Ben Quinn",
      adultAttested: true,
    });
    if (!result.ok) throw new Error(`split refused: ${result.reason}`);

    const [item] = await db.select().from(lostItems).where(eq(lostItems.id, recorded.item.id));
    expect(item?.personId).toBe(result.personId);
    expect(item?.bookingId).toBe(shared.bookingId);
  });

  it("clears the told mark on an item it moves, so the new diver can be told", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const night = trips.find((t) => t.title.startsWith("Night Dive"));
    if (!night) throw new Error("expected seeded trip missing");
    const first = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: night.id,
      fullName: "Nora Quinn",
      email: "nora-told@example.com",
    });
    if (!first.ok) throw new Error("setup booking failed");
    const other = trips.find((t) => t.id !== night.id && !t.courseId);
    if (!other) throw new Error("expected a second seeded trip");
    const shared = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: other.id,
      personId: first.personId,
      fromNameMatch: { typedName: "Ben Quinn" },
    });
    if (!shared.ok) throw new Error("held-seat booking failed");
    const [staffer] = await listStaff(db, shop.id);
    if (!staffer) throw new Error("expected seeded staff");
    const recorded = await recordLostItem(db, {
      shopId: shop.id,
      tripId: other.id,
      bookingId: shared.bookingId,
      description: "Blue mask in a red case",
      actorPersonId: staffer.person.id,
    });
    if (!recorded.ok) throw new Error(`lost item refused: ${recorded.reason}`);
    const email = fakeEmail();
    expect(
      await tellLostItemOwner(
        db,
        { shopId: shop.id, itemId: recorded.item.id },
        { emailProvider: email.provider },
      ),
    ).toEqual({ ok: true, channel: "email" });

    const result = await splitBookingIdentity(db, {
      shopId: shop.id,
      bookingId: shared.bookingId,
      actorPersonId: staffer.person.id,
      fullName: "Ben Quinn",
      adultAttested: true,
    });
    if (!result.ok) throw new Error(`split refused: ${result.reason}`);

    const [item] = await db.select().from(lostItems).where(eq(lostItems.id, recorded.item.id));
    expect(item).toMatchObject({ personId: result.personId, toldAt: null, toldChannel: null });
    // Not "already told": the item names someone who has not been.
    expect(
      await tellLostItemOwner(
        db,
        { shopId: shop.id, itemId: recorded.item.id },
        { emailProvider: email.provider },
      ),
    ).not.toEqual({ ok: false, reason: "already_told" });
  });
});
